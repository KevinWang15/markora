import { afterEach, describe, expect, it, vi } from "vitest";
import { DOMParser as ProseMirrorDOMParser } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import { CellSelection, tableEditingKey } from "prosemirror-tables";
import { createEditor, type MarkdownEditor } from "../src";
import { createTableEditing } from "../src/tableEditing";
import { setMarkdownEditorExternalUpdatePermission } from "../src/transactionOrigin";

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
}

const editors: MarkdownEditor[] = [];
const tableMarkdown = [
  "| H1 | H2 | H3 |",
  "| --- | --- | --- |",
  "| a | b | c |",
  "| d | e | f |",
].join("\n");

function host() {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

function editor(markdown = tableMarkdown) {
  const instance = createEditor({ element: host(), markdown });
  editors.push(instance);
  return instance;
}

function tableCells(instance: MarkdownEditor) {
  const rows: Array<Array<{ node: Parameters<Parameters<typeof instance.view.state.doc.descendants>[0]>[0]; pos: number }>> = [];
  let rowIndex = -1;
  instance.view.state.doc.descendants((node, pos) => {
    if (node.type.name === "table_row") {
      rowIndex += 1;
      rows.push([]);
    } else if (node.type.name === "table_cell" || node.type.name === "table_header") {
      rows[rowIndex].push({ node, pos });
      return false;
    }
    return true;
  });
  return rows;
}

function selectText(instance: MarkdownEditor, value: string) {
  let position: number | null = null;
  instance.view.state.doc.descendants((node, pos) => {
    const index = node.isText ? (node.text ?? "").indexOf(value) : -1;
    if (index >= 0) {
      position = pos + index + value.length;
      return false;
    }
    return position === null;
  });
  if (position === null) throw new Error(`Missing text ${value}`);
  instance.view.dispatch(instance.view.state.tr.setSelection(
    TextSelection.create(instance.view.state.doc, position),
  ));
}

function selectCells(
  instance: MarkdownEditor,
  anchorRow: number,
  anchorColumn: number,
  headRow = anchorRow,
  headColumn = anchorColumn,
) {
  const cells = tableCells(instance);
  instance.view.dispatch(instance.view.state.tr.setSelection(CellSelection.create(
    instance.view.state.doc,
    cells[anchorRow][anchorColumn].pos,
    cells[headRow][headColumn].pos,
  )));
}

function tableText(instance: MarkdownEditor) {
  return tableCells(instance).map((row) => row.map(({ node }) => node.textContent));
}

function selectedCellText(instance: MarkdownEditor) {
  const { $from } = instance.view.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "table_cell" || node.type.name === "table_header") {
      return node.textContent;
    }
  }
  return null;
}

function press(instance: MarkdownEditor, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    ...init,
  });
  instance.view.dom.dispatchEvent(event);
  return event;
}

function transfer(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    clearData: vi.fn(() => values.clear()),
    files: { length: 0 },
    getData: vi.fn((type: string) => values.get(type) ?? ""),
    items: [{ kind: "string" }],
    setData: vi.fn((type: string, value: string) => values.set(type, value)),
    types: [...values.keys()],
    values,
  };
}

function clipboardEvent(type: "copy" | "cut" | "paste", data: ReturnType<typeof transfer>) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", { configurable: true, value: data });
  return event;
}

afterEach(() => {
  for (const instance of editors.splice(0)) instance.destroy();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("mature table commands", () => {
  it("edits rectangular selections and exposes table-cell state", () => {
    const instance = editor();
    const selectionKinds: string[] = [];
    instance.subscribe("selection", ({ selection }) => selectionKinds.push(selection.kind));
    selectCells(instance, 1, 0, 2, 1);

    expect(instance.state.isActive.tableCellSelection()).toBe(true);
    expect(selectionKinds.at(-1)).toBe("table-cell");
    expect(instance.commands.setTableColumnAlignment("center")).toBe(true);
    expect(instance.state.isActive.tableColumnAlignment("center")).toBe(true);
    expect(instance.state.isActive.tableCellSelection()).toBe(true);
    expect(instance.commands.deleteTableColumn()).toBe(true);
    expect(tableText(instance)).toEqual([["H3"], ["c"], ["f"]]);
    expect(instance.getMarkdown()).toBe("| H3 |\n| --- |\n| c |\n| f |");
    expect(instance.commands.undo()).toBe(true);
    expect(tableText(instance)).toEqual([
      ["H1", "H2", "H3"],
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
  });

  it("does not collapse cell selections for modified and composing keys", () => {
    const instance = editor();
    const adapter = createTableEditing({
      reportBrowserError: () => undefined,
      schema: instance.view.state.schema,
    }).plugins[0];
    const handleKeyDown = adapter.props.handleKeyDown!;

    for (const [key, init] of [
      ["Escape", { ctrlKey: true }],
      ["Enter", { ctrlKey: true }],
      ["F2", { ctrlKey: true }],
      ["Enter", { isComposing: true }],
    ] as const) {
      selectCells(instance, 1, 0, 2, 1);
      const event = new KeyboardEvent("keydown", { key, ...init });
      expect(handleKeyDown(instance.view, event), key).toBe(false);
      expect(instance.state.isActive.tableCellSelection(), key).toBe(true);
    }
  });

  it("supports before/after insertion, pinned-header reordering, and bounded resizing", () => {
    const instance = editor();
    selectText(instance, "b");

    expect(instance.commands.addTableColumn("before")).toBe(true);
    expect(tableText(instance)[1]).toEqual(["a", "", "b", "c"]);
    selectText(instance, "b");
    expect(instance.commands.moveTableColumn("left")).toBe(true);
    expect(tableText(instance)[1]).toEqual(["a", "b", "", "c"]);

    selectText(instance, "d");
    expect(instance.commands.moveTableRow("up")).toBe(true);
    expect(tableText(instance)[1][0]).toBe("d");
    expect(instance.state.can.moveTableRow("up")).toBe(false);
    expect(instance.commands.addTableRow("before")).toBe(true);
    expect(tableText(instance)[1]).toEqual(["", "", "", ""]);

    expect(instance.commands.resizeTable({ rows: 4, columns: 5 })).toBe(true);
    expect(tableText(instance)).toHaveLength(4);
    expect(tableText(instance).every((row) => row.length === 5)).toBe(true);
    expect(instance.state.can.resizeTable({ rows: 2, columns: 2 })).toBe(false);
    expect(instance.commands.resizeTable({ rows: 2, columns: 2 })).toBe(false);
    expect(instance.commands.resizeTable({ rows: 2, columns: 2, discardContent: true })).toBe(true);
    expect(tableText(instance).map((row) => row.length)).toEqual([2, 2]);
    expect(instance.getMarkdown().split("\n")[1]).toMatch(/^\| [:-]+ \| [:-]+ \|$/);
  });

  it("validates new arguments and enforces the 100 by 100 invariant", () => {
    const instance = editor();
    expect(() => instance.state.can.addTableRow("sideways" as never)).toThrow(RangeError);
    expect(() => instance.commands.moveTableColumn("up" as never)).toThrow(RangeError);
    expect(() => instance.commands.resizeTable({})).toThrow(TypeError);
    expect(() => instance.commands.resizeTable({ rows: 101 })).toThrow(RangeError);

    expect(instance.commands.resizeTable({ rows: 100 })).toBe(true);
    selectText(instance, "a");
    expect(instance.state.can.addTableRow()).toBe(false);
    expect(instance.commands.addTableRow()).toBe(false);
  });

  it("removes root drag listeners when destroyed during cell selection", () => {
    const instance = editor();
    const addListener = vi.spyOn(document, "addEventListener");
    const removeListener = vi.spyOn(document, "removeEventListener");
    const cell = instance.view.dom.querySelector("td")!;
    const event = new MouseEvent("mousedown", {
      button: 0,
      cancelable: true,
    });
    Object.defineProperty(event, "target", { value: cell });
    const plugin = instance.view.state.plugins.find(({ key }) => key === tableEditingKey.key)!;
    const handler = plugin.props.handleDOMEvents?.mousedown!;
    handler.call(plugin, instance.view, event);
    const dragListeners = addListener.mock.calls.filter(([type]) => (
      type === "dragstart" || type === "mousemove" || type === "mouseup"
    ));

    expect(dragListeners.map(([type]) => type).sort()).toEqual([
      "dragstart",
      "mousemove",
      "mouseup",
    ]);
    instance.destroy();

    for (const [type, listener, options] of dragListeners) {
      expect(removeListener).toHaveBeenCalledWith(type, listener, options);
    }
  });

  it("removes drag listeners added after a selection subscriber destroys the view", () => {
    const instance = editor();
    selectCells(instance, 1, 0);
    const cells = tableCells(instance);
    const target = instance.view.dom.querySelectorAll("td")[1]!;
    vi.spyOn(instance.view, "posAtCoords").mockReturnValue({
      inside: cells[1][1].pos,
      pos: cells[1][1].pos + 1,
    });
    const addListener = vi.spyOn(document, "addEventListener");
    const removeListener = vi.spyOn(document, "removeEventListener");
    instance.subscribe("selection", () => instance.destroy());
    const event = new MouseEvent("mousedown", {
      button: 0,
      cancelable: true,
      shiftKey: true,
    });
    Object.defineProperty(event, "target", { value: target });
    const plugin = instance.view.state.plugins.find(({ key }) => key === tableEditingKey.key)!;
    const handler = plugin.props.handleDOMEvents?.mousedown!;

    handler.call(plugin, instance.view, event);

    expect(instance.isDestroyed).toBe(true);
    const dragListeners = addListener.mock.calls.filter(([type]) => (
      type === "dragstart" || type === "mousemove" || type === "mouseup"
    ));
    expect(dragListeners).toHaveLength(3);
    for (const [type, listener, options] of dragListeners) {
      expect(removeListener).toHaveBeenCalledWith(type, listener, options);
    }
  });

  it("keeps multiline and nested-block vertical movement bounded while Tab stays row-major", () => {
    const instance = editor();
    const { schema } = instance.view.state;
    const paragraph = schema.nodes.paragraph;
    const list = schema.nodes.bullet_list;
    const item = schema.nodes.list_item;
    const header = schema.nodes.table_header;
    const cell = schema.nodes.table_cell;
    const row = schema.nodes.table_row;
    const table = schema.nodes.table;
    const textBlock = (value?: string) => paragraph.create(
      null,
      value ? schema.text(value) : undefined,
    );
    const document = schema.topNodeType.create(null, table.create(null, [
      row.create(null, [
        header.create({ scope: "col" }, textBlock("H1")),
        header.create({ scope: "col" }, textBlock("H2")),
      ]),
      row.create(null, [
        cell.create(null, [
          textBlock("first"),
          list.create(null, item.create(null, textBlock("nested"))),
        ]),
        cell.create(null, textBlock()),
      ]),
      row.create(null, [
        cell.create(null, textBlock("below")),
        cell.create(null, textBlock("after")),
      ]),
    ]));
    instance.view.dispatch(instance.view.state.tr.replaceWith(
      0,
      instance.view.state.doc.content.size,
      document.content,
    ));

    selectText(instance, "first");
    const initialPosition = instance.view.state.selection.from;
    vi.spyOn(instance.view, "coordsAtPos").mockImplementation((position) => (
      position === initialPosition
        ? { bottom: 10, left: 0, right: 0, top: 0 }
        : { bottom: 30, left: 0, right: 0, top: 20 }
    ));
    press(instance, "ArrowDown");
    expect(instance.view.state.selection.from).toBe(initialPosition);

    vi.mocked(instance.view.coordsAtPos).mockRestore();
    selectText(instance, "nested");
    press(instance, "ArrowDown");
    expect(selectedCellText(instance)).toBe("below");

    selectText(instance, "nested");
    press(instance, "Tab");
    expect(selectedCellText(instance)).toBe("");
    press(instance, "Tab");
    expect(selectedCellText(instance)).toBe("below");
    press(instance, "Tab", { shiftKey: true });
    expect(selectedCellText(instance)).toBe("");
  });

  it("allows table normalization appended to a permitted read-only reconciliation", () => {
    const instance = editor();
    const { schema } = instance.view.state;
    const paragraph = schema.nodes.paragraph;
    const header = schema.nodes.table_header;
    const cell = schema.nodes.table_cell;
    const row = schema.nodes.table_row;
    const table = schema.nodes.table;
    const textBlock = (value: string) => paragraph.create(null, schema.text(value));
    const ragged = table.create(null, [
      row.create(null, [
        header.create({ scope: "col" }, textBlock("H1")),
        header.create({ scope: "col" }, textBlock("H2")),
      ]),
      row.create(null, cell.create(null, textBlock("value"))),
    ]);
    instance.updateOptions({ editable: false });
    const transaction = instance.view.state.tr.replaceWith(
      0,
      instance.view.state.doc.content.size,
      ragged,
    );
    setMarkdownEditorExternalUpdatePermission(transaction);
    instance.view.dispatch(transaction);

    expect(tableText(instance)).toEqual([
      ["H1", "H2"],
      ["value", ""],
    ]);
  });
});

describe("rectangular table clipboard", () => {
  it("copies body rectangles as semantic HTML, quoted TSV, and valid standalone GFM", () => {
    const instance = editor();
    selectCells(instance, 1, 0, 2, 1);
    const data = transfer();
    const event = clipboardEvent("copy", data);
    instance.view.dom.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(data.values.get("text/plain")).toBe("a\tb\nd\te");
    expect(data.values.get("text/markdown")).toBe([
      "| a | b |",
      "| --- | --- |",
      "| d | e |",
    ].join("\n"));
    expect(data.values.get("text/html")).toContain("<table");
    expect(data.values.get("text/html")).toContain("<td");
  });

  it("clears a rectangular cut only after writing and restores it in one undo", () => {
    const instance = editor();
    selectCells(instance, 1, 0, 2, 1);
    const event = clipboardEvent("cut", transfer());
    instance.view.dom.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(tableText(instance)).toEqual([
      ["H1", "H2", "H3"],
      ["", "", "c"],
      ["", "", "f"],
    ]);
    expect(instance.commands.undo()).toBe(true);
    expect(tableText(instance)).toEqual([
      ["H1", "H2", "H3"],
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
  });

  it("fills a selected rectangle from a plain TSV matrix and undoes atomically", () => {
    const instance = editor();
    selectCells(instance, 1, 0, 2, 1);
    const event = clipboardEvent("paste", transfer({
      "text/plain": "one\ttwo\nthree\tfour",
    }));
    instance.view.dom.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(tableText(instance)).toEqual([
      ["H1", "H2", "H3"],
      ["one", "two", "c"],
      ["three", "four", "f"],
    ]);
    expect(instance.commands.undo()).toBe(true);
    expect(tableText(instance)[1]).toEqual(["a", "b", "c"]);
    expect(tableText(instance)[2]).toEqual(["d", "e", "f"]);
  });

  it("fills scalar values and preserves quoted tabs, line breaks, and quotes", () => {
    const instance = editor();
    selectCells(instance, 1, 0, 2, 1);
    instance.view.dom.dispatchEvent(clipboardEvent("paste", transfer({
      "text/plain": "same",
    })));
    expect(tableText(instance)).toEqual([
      ["H1", "H2", "H3"],
      ["same", "same", "c"],
      ["same", "same", "f"],
    ]);

    expect(instance.commands.undo()).toBe(true);
    selectCells(instance, 1, 0, 2, 1);
    instance.view.dom.dispatchEvent(clipboardEvent("paste", transfer({
      "text/plain": '"one\tinside"\ttwo\n"three\nlines"\t"four""quotes"',
    })));
    expect(tableText(instance)[1]).toEqual(["one\tinside", "two", "c"]);
    expect(tableText(instance)[2]).toEqual(["three\nlines", 'four"quotes', "f"]);

    const copied = transfer();
    instance.view.dom.dispatchEvent(clipboardEvent("copy", copied));
    expect(copied.values.get("text/plain")).toBe(
      '"one\tinside"\ttwo\n"three\nlines"\t"four""quotes"',
    );
  });

  it("rejects merged and oversized rich table paste atomically", () => {
    const instance = editor();
    const errors: unknown[] = [];
    instance.subscribe("error", (event) => {
      if (event.code === "table-operation-rejected") errors.push(event.error);
    });
    selectText(instance, "b");
    const before = instance.getMarkdown();
    const mergedEvent = clipboardEvent("paste", transfer({
      "text/html": "<table><tr><td colspan=\"2\">merged</td></tr></table>",
      "text/plain": "merged",
    }));
    instance.view.dom.dispatchEvent(mergedEvent);

    expect(mergedEvent.defaultPrevented).toBe(true);
    expect(instance.getMarkdown()).toBe(before);
    expect(errors.at(-1)).toBeInstanceOf(RangeError);

    const cells = Array.from({ length: 101 }, (_, index) => `<td>${index}</td>`).join("");
    const oversizedEvent = clipboardEvent("paste", transfer({
      "text/html": `<table><tr>${cells}</tr></table>`,
      "text/plain": "oversized",
    }));
    instance.view.dom.dispatchEvent(oversizedEvent);

    expect(oversizedEvent.defaultPrevented).toBe(true);
    expect(instance.getMarkdown()).toBe(before);
    expect(errors).toHaveLength(2);
    expect(errors.at(-1)).toBeInstanceOf(RangeError);

    selectCells(instance, 1, 0, 2, 1);
    const oversizedTsvEvent = clipboardEvent("paste", transfer({
      "text/plain": Array.from({ length: 101 }, (_, index) => String(index)).join("\t"),
    }));
    instance.view.dom.dispatchEvent(oversizedTsvEvent);

    expect(oversizedTsvEvent.defaultPrevented).toBe(true);
    expect(instance.getMarkdown()).toBe(before);
    expect(errors).toHaveLength(3);
    expect(errors.at(-1)).toBeInstanceOf(RangeError);
  });
});

describe("table GFM fidelity reporting", () => {
  it("exposes bounded table roles and DOM span attributes required by the selection engine", () => {
    const instance = editor();
    const { schema } = instance.view.state;
    expect(schema.nodes.table.spec.tableRole).toBe("table");
    expect(schema.nodes.table_row.spec.tableRole).toBe("row");
    expect(schema.nodes.table_cell.spec.tableRole).toBe("cell");
    expect(schema.nodes.table_header.spec.tableRole).toBe("header_cell");

    const source = document.createElement("div");
    source.innerHTML = [
      "<table><tbody>",
      '<tr><th colspan="999" rowspan="0" data-colwidth="5000">H</th></tr>',
      '<tr><td colspan="2" data-colwidth="40,60">value</td></tr>',
      "</tbody></table>",
    ].join("");
    const parsed = ProseMirrorDOMParser.fromSchema(schema).parse(source);
    const header = parsed.firstChild!.firstChild!.firstChild!;
    const cell = parsed.firstChild!.lastChild!.firstChild!;
    expect(header.attrs).toMatchObject({ colspan: 100, rowspan: 1, colwidth: null });
    expect(cell.attrs).toMatchObject({ colspan: 2, rowspan: 1, colwidth: [40, 60] });
    expect(() => parsed.check()).not.toThrow();
  });

  it("reports merged, multi-block, and HTML-only row-header constructs", () => {
    const instance = editor();
    const errors: unknown[] = [];
    instance.subscribe("error", (event) => {
      if (event.code === "table-operation-rejected") errors.push(event.error);
    });
    const { schema } = instance.view.state;
    const paragraph = schema.nodes.paragraph;
    const header = schema.nodes.table_header;
    const cell = schema.nodes.table_cell;
    const row = schema.nodes.table_row;
    const table = schema.nodes.table;
    const document = schema.topNodeType.create(null, table.create(null, [
      row.create(null, [
        header.create({ scope: "col" }, paragraph.create(null, schema.text("H1"))),
        header.create({ scope: "col" }, paragraph.create(null, schema.text("H2"))),
      ]),
      row.create(null, [
        header.create({ scope: "row" }, paragraph.create(null, schema.text("R1"))),
        cell.create({ colspan: 2 }, [
          paragraph.create(null, schema.text("one")),
          paragraph.create(null, schema.text("two")),
        ]),
      ]),
    ]));
    instance.view.dispatch(instance.view.state.tr.replaceWith(
      0,
      instance.view.state.doc.content.size,
      document.content,
    ));

    const codes = instance.state.tableIssues().map((issue) => issue.code);
    expect(codes).toContain("row-header-scope");
    expect(codes).toContain("merged-cell");
    expect(codes).toContain("multi-block-cell");

    selectText(instance, "one");
    expect(instance.state.can.addTableColumn()).toBe(false);
    expect(instance.commands.resizeTable({ columns: 3 })).toBe(false);
    expect(instance.state.can.deleteTable()).toBe(true);

    selectCells(instance, 1, 1);
    const copied = transfer();
    const copyEvent = clipboardEvent("copy", copied);
    instance.view.dom.dispatchEvent(copyEvent);
    expect(copyEvent.defaultPrevented).toBe(true);
    expect(copied.values.get("text/html")).toContain("colspan");
    expect(copied.values.has("text/markdown")).toBe(false);
    expect(errors).toHaveLength(1);

    const beforeCut = instance.view.state.doc;
    instance.view.dom.dispatchEvent(clipboardEvent("cut", transfer()));
    expect(instance.view.state.doc.eq(beforeCut)).toBe(true);
    expect(errors).toHaveLength(2);
  });
});

it("public clipboard capture preserves rectangular table shape on a deferred cut and paste", () => {
  const instance = editor();
  selectCells(instance, 1, 0, 2, 1);
  const capture = instance.clipboard.captureSelection()!;
  expect(capture.content.text).toBe("a\tb\nd\te");
  expect(capture.content.markdown).toBe("| a | b |\n| --- | --- |\n| d | e |");
  expect(capture.deleteSelection()).toBe(true);
  expect(tableText(instance)).toEqual([["H1", "H2", "H3"], ["", "", "c"], ["", "", "f"]]);
  expect(instance.clipboard.paste(capture.content)).toBe(true);
  expect(tableText(instance)).toEqual([["H1", "H2", "H3"], ["a", "b", "c"], ["d", "e", "f"]]);
});
