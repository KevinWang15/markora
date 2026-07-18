import { afterEach, describe, expect, it } from "vitest";
import {
  createEditor as createRootEditor,
  type MarkdownEditor,
} from "markora";
import { createEditor as createMinimalEditor } from "markora/minimal";
import { NodeSelection, TextSelection } from "markora/extension-api";
import { createFootnotesExtension } from "../../extension-footnotes/src/index";
import {
  alertKinds,
  createAlertsExtension,
  defaultAlertsMessages,
} from "../src/index";

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = (() => new DOMRect()) as () => DOMRect;
}

const entries = [
  ["root", createRootEditor],
  ["minimal", createMinimalEditor],
] as const;
const editors: MarkdownEditor[] = [];

function host() {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

function track(editor: MarkdownEditor) {
  editors.push(editor);
  return editor;
}

function nodeNames(editor: MarkdownEditor) {
  const names: string[] = [];
  editor.view.state.doc.descendants((node) => {
    names.push(node.type.name);
    return true;
  });
  return names;
}

function alertPositions(editor: MarkdownEditor) {
  const positions: number[] = [];
  editor.view.state.doc.descendants((node, position) => {
    if (node.type.name === "alert") {
      positions.push(position);
    }
    return true;
  });
  return positions;
}

function setTextSelection(editor: MarkdownEditor, from: number, to = from) {
  editor.view.dispatch(
    editor.view.state.tr.setSelection(
      TextSelection.create(editor.view.state.doc, from, to),
    ),
  );
}

afterEach(() => {
  while (editors.length > 0) {
    editors.pop()?.destroy();
  }
  document.body.replaceChildren();
});

describe.each(entries)("%s alerts extension", (_entry, createEditor) => {
  it("recognizes all five kinds, normalizes case, and preserves root/minimal parity", () => {
    const extension = createAlertsExtension();
    const source = [
      "> [!note]",
      "> Note body",
      "",
      ">\t[!Tip]  ",
      "> Tip body",
      "",
      "> [!IMPORTANT]",
      "> Important body",
      "",
      "> [!warning]",
      "> Warning body",
      "",
      "> [!Caution]",
      "> Caution body",
    ].join("\n");
    const canonical = source.replace(
      /\[!(note|Tip|warning|Caution)\]/g,
      (marker) => marker.toUpperCase(),
    ).replace(">\t[!TIP]  ", "> [!TIP]");
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: source,
    }));
    const handle = editor.extensions.get(extension);

    expect(handle.state.getAlerts()).toEqual(alertKinds.map((kind, index) => ({
      kind,
      position: expect.any(Number),
    })));
    expect(editor.view.dom.querySelectorAll("[data-mdw-alert]")).toHaveLength(5);
    expect(editor.getMarkdown()).toBe(canonical);
    editor.commands.resetMarkdown(canonical);
    expect(editor.getMarkdown()).toBe(canonical);
    expect(handle.state.getAlerts().map(({ kind }) => kind)).toEqual(alertKinds);
    expect(editor.extensions.manifest.extensions).toContainEqual({
      name: "markora-extension-alerts",
      version: "0.0.1",
    });
  });

  it("retains paragraphs, nested lists, code blocks, blockquotes, and nested alerts", () => {
    const extension = createAlertsExtension();
    const source = [
      "> [!TIP]",
      ">",
      "> Paragraph with *emphasis*.",
      ">",
      "> - first",
      ">   - nested",
      ">",
      "> > Ordinary nested quote",
      ">",
      "> > [!WARNING]",
      "> > Nested alert",
      ">",
      "> ```js",
      "> const value = 1;",
      "> ```",
    ].join("\n");
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: source,
    }));
    const handle = editor.extensions.get(extension);
    const canonical = editor.getMarkdown();

    expect(handle.state.getAlerts().map(({ kind }) => kind)).toEqual([
      "tip",
      "warning",
    ]);
    expect(nodeNames(editor)).toEqual(expect.arrayContaining([
      "alert",
      "bullet_list",
      "list_item",
      "blockquote",
      "code_block",
    ]));
    expect(editor.view.state.doc.textContent).toContain("Paragraph with emphasis.");
    expect(editor.view.state.doc.textContent).toContain("Nested alert");
    editor.commands.resetMarkdown(canonical);
    expect(editor.getMarkdown()).toBe(canonical);
  });

  it("keeps a leading thematic break separate from the alert marker", () => {
    const extension = createAlertsExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "> [!NOTE]\n> ***\n> Body",
    }));
    const canonical = editor.getMarkdown();

    expect(editor.extensions.get(extension).state.getAlerts()).toEqual([{
      kind: "note",
      position: 0,
    }]);
    expect(nodeNames(editor)).toContain("horizontal_rule");
    expect(canonical).toBe("> [!NOTE]\n>\n> ---\n>\n> Body");

    editor.commands.resetMarkdown(canonical);
    expect(editor.getMarkdown()).toBe(canonical);
    expect(editor.extensions.get(extension).state.getAlerts()).toEqual([{
      kind: "note",
      position: 0,
    }]);
    expect(nodeNames(editor)).toContain("horizontal_rule");
  });

  it("recovers a no-blank thematic break consumed as a Setext underline", () => {
    const extension = createAlertsExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "> [!NOTE]\n> ---\n> Body",
    }));
    const canonical = "> [!NOTE]\n>\n> ---\n>\n> Body";

    expect(editor.extensions.get(extension).state.getAlerts()).toHaveLength(1);
    expect(nodeNames(editor)).toContain("horizontal_rule");
    expect(editor.getMarkdown()).toBe(canonical);

    editor.commands.resetMarkdown(canonical);
    expect(editor.getMarkdown()).toBe(canonical);
    expect(editor.extensions.get(extension).state.getAlerts()).toHaveLength(1);
    expect(nodeNames(editor)).toContain("horizontal_rule");
  });

  it("recovers no-blank Setext headings as the first alert body block", () => {
    const extension = createAlertsExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: [
        "> [!NOTE]",
        "> Alpha",
        "> ===",
        "",
        "> [!TIP]",
        "> Beta",
        "> ---",
      ].join("\n"),
    }));
    const canonical = [
      "> [!NOTE]",
      ">",
      "> # Alpha",
      "",
      "> [!TIP]",
      ">",
      "> ## Beta",
    ].join("\n");

    expect(editor.extensions.get(extension).state.getAlerts().map(({ kind }) => kind))
      .toEqual(["note", "tip"]);
    expect(editor.view.state.doc.firstChild?.firstChild?.type.name).toBe("heading");
    expect(editor.getMarkdown()).toBe(canonical);

    editor.commands.resetMarkdown(canonical);
    expect(editor.getMarkdown()).toBe(canonical);
    expect(editor.extensions.get(extension).state.getAlerts().map(({ kind }) => kind))
      .toEqual(["note", "tip"]);
  });

  it("keeps immediate and lazy continuation lines in the first editable body paragraph", () => {
    const extension = createAlertsExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "> [!warning]\n> First line\nlazy continuation",
    }));

    expect(editor.extensions.get(extension).state.getAlerts()).toHaveLength(1);
    expect(editor.view.state.doc.firstChild?.firstChild?.textContent)
      .toBe("First line lazy continuation");
    expect(editor.getMarkdown()).toBe("> [!WARNING]\n> First line lazy continuation");
  });

  it("represents marker-only alerts with an editable empty paragraph", () => {
    const extension = createAlertsExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "> [!IMPORTANT]",
    }));
    const alert = editor.view.state.doc.firstChild;

    expect(alert?.type.name).toBe("alert");
    expect(alert?.childCount).toBe(1);
    expect(alert?.firstChild?.type.name).toBe("paragraph");
    expect(editor.getMarkdown()).toBe("> [!IMPORTANT]");
  });

  it.each([
    ["unknown kind", "> [!DANGER]\n> Body"],
    ["trailing title", "> [!NOTE] Deploy\n> Body"],
    ["escaped marker", "> \\[!NOTE]\n> Body"],
    ["formatted marker", "> **[!NOTE]**\n> Body"],
    ["code marker", "> `[!NOTE]`\n> Body"],
    ["heading marker", "> # [!NOTE]\n> Body"],
    ["non-first marker", "> Intro\n> [!NOTE]\n> Body"],
    ["leading blank quoted line", ">\n> [!NOTE]\n> Body"],
    ["non-ASCII marker whitespace", "> \u00a0[!NOTE]\n> Body"],
    ["indented-code marker", ">     [!NOTE]\n> Body"],
    ["missing exclamation", "> [NOTE]\n> Body"],
    ["missing closing bracket", "> [!NOTE\n> Body"],
    ["equals-only Setext underline", "> [!NOTE]\n> ==="],
    ["directive dialect", ":::note\nBody\n:::"],
  ])("leaves the %s fallback outside alert semantics", (_label, source) => {
    const extension = createAlertsExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: source,
    }));
    const canonical = editor.getMarkdown();

    expect(editor.extensions.get(extension).state.getAlerts()).toEqual([]);
    expect(nodeNames(editor)).not.toContain("alert");
    editor.commands.resetMarkdown(canonical);
    expect(editor.getMarkdown()).toBe(canonical);
    expect(editor.extensions.get(extension).state.getAlerts()).toEqual([]);
  });

  it("keeps ordinary alert-looking blockquote text a non-alert fixed point", () => {
    const extension = createAlertsExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: "> [!NOTE] trailing",
    }));
    const canonical = editor.getMarkdown();

    expect(editor.view.state.doc.firstChild?.type.name).toBe("blockquote");
    expect(canonical).not.toBe("> [!NOTE]");
    editor.commands.resetMarkdown(canonical);
    expect(editor.view.state.doc.firstChild?.type.name).toBe("blockquote");
  });

  it("keeps later marker-looking body paragraphs inside one alert", () => {
    const extension = createAlertsExtension();
    const editor = track(createEditor({
      element: host(),
      extensions: [extension],
      markdown: [
        "> [!NOTE]",
        ">",
        "> First paragraph.",
        ">",
        "> [!TIP]",
        "> This is body text.",
      ].join("\n"),
    }));
    const canonical = editor.getMarkdown();

    expect(editor.extensions.get(extension).state.getAlerts()).toHaveLength(1);
    expect(editor.extensions.get(extension).state.getAlerts()[0]?.kind).toBe("note");
    expect(canonical).toContain(String.raw`\[!TIP\]`);
    editor.commands.resetMarkdown(canonical);
    expect(editor.extensions.get(extension).state.getAlerts()).toHaveLength(1);
    expect(editor.view.state.doc.textContent).toContain("[!TIP]");
  });
});

it("round-trips a root alert whose first body block is a pipe table", () => {
  const extension = createAlertsExtension();
  const source = [
    "> [!NOTE]",
    ">",
    "> | A |",
    "> | --- |",
    "> | x |",
  ].join("\n");
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: source,
  }));

  expect(editor.view.state.doc.firstChild?.type.name).toBe("alert");
  expect(editor.view.state.doc.firstChild?.firstChild?.type.name).toBe("table");
  expect(editor.getMarkdown()).toBe(source);

  editor.commands.resetMarkdown(source);
  expect(editor.view.state.doc.firstChild?.type.name).toBe("alert");
  expect(editor.view.state.doc.firstChild?.firstChild?.type.name).toBe("table");
  expect(editor.getMarkdown()).toBe(source);
});

it("keeps a leading footnote definition separate from the alert marker", () => {
  const alerts = createAlertsExtension();
  const footnotes = createFootnotesExtension();
  const source = "> [!NOTE]\n>\n> [^x]: Definition.";
  const editor = track(createRootEditor({
    element: host(),
    extensions: [alerts, footnotes],
    markdown: source,
  }));

  expect(editor.view.state.doc.firstChild?.type.name).toBe("alert");
  expect(editor.view.state.doc.firstChild?.firstChild?.type.name)
    .toBe("footnote_definition");
  expect(editor.getMarkdown()).toBe(source);

  editor.commands.resetMarkdown(source);
  expect(editor.view.state.doc.firstChild?.type.name).toBe("alert");
  expect(editor.view.state.doc.firstChild?.firstChild?.type.name)
    .toBe("footnote_definition");
  expect(editor.getMarkdown()).toBe(source);
});

it("wraps, changes kind, unwraps, and reports active state without losing selection", () => {
  const origins: Array<string | undefined> = [];
  const extension = createAlertsExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "Alpha text\n\nBeta",
    onTransaction(_transaction, _view, context) {
      if (context.origin) {
        origins.push(context.origin);
      }
    },
  }));
  const handle = editor.extensions.get(extension);
  setTextSelection(editor, 1, 6);
  const selected = editor.view.state.doc.textBetween(
    editor.view.state.selection.from,
    editor.view.state.selection.to,
  );

  expect(handle.state.canWrap("tip")).toBe(true);
  expect(handle.commands.wrap("tip")).toBe(true);
  expect(handle.state.getActive()).toEqual({ kind: "tip", position: 0 });
  expect(handle.state.isActive()).toBe(true);
  expect(handle.state.canWrap()).toBe(false);
  expect(handle.state.canUnwrap()).toBe(true);
  expect(editor.view.state.doc.textBetween(
    editor.view.state.selection.from,
    editor.view.state.selection.to,
  )).toBe(selected);
  expect(handle.commands.setKind("warning")).toBe(true);
  expect(handle.commands.setKind("warning")).toBe(false);
  expect(handle.state.canSetKind("warning")).toBe(false);
  expect(handle.state.canSetKind("caution")).toBe(true);
  expect(editor.getMarkdown()).toContain("> [!WARNING]\n> Alpha text");
  expect(handle.commands.unwrap()).toBe(true);
  expect(handle.commands.unwrap()).toBe(false);
  expect(editor.getMarkdown()).toBe("Alpha text\n\nBeta");
  expect(origins.filter((origin) => origin === "extension:markora-extension-alerts"))
    .toHaveLength(3);

  expect(editor.commands.undo()).toBe(true);
  expect(handle.state.getAlerts()[0]?.kind).toBe("warning");
  expect(editor.commands.undo()).toBe(true);
  expect(handle.state.getAlerts()[0]?.kind).toBe("tip");
  expect(editor.commands.undo()).toBe(true);
  expect(handle.state.getAlerts()).toEqual([]);
  expect(editor.commands.redo()).toBe(true);
  expect(handle.state.getAlerts()[0]?.kind).toBe("tip");
});

it("toggle wraps with the requested kind and unwraps the active alert", () => {
  const extension = createAlertsExtension();
  const editor = track(createMinimalEditor({
    element: host(),
    extensions: [extension],
    markdown: "Body",
  }));
  const handle = editor.extensions.get(extension);
  setTextSelection(editor, 1);

  expect(handle.state.canToggle("caution")).toBe(true);
  expect(handle.commands.toggle("caution")).toBe(true);
  expect(handle.state.getActive()?.kind).toBe("caution");
  expect(handle.commands.toggle()).toBe(true);
  expect(handle.state.isActive()).toBe(false);
  expect(editor.getMarkdown()).toBe("Body");
});

it("unwraps the whole active alert even when the cursor is inside a nested list", () => {
  const extension = createAlertsExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "> [!NOTE]\n>\n> - first\n>   - nested",
  }));
  const handle = editor.extensions.get(extension);
  const nestedText = editor.view.state.doc.textContent.indexOf("nested");
  let nestedPosition = 1;
  editor.view.state.doc.descendants((node, position) => {
    if (node.isText && node.text?.includes("nested")) {
      nestedPosition = position + 1;
      return false;
    }
    return true;
  });
  expect(nestedText).toBeGreaterThanOrEqual(0);
  setTextSelection(editor, nestedPosition);

  expect(handle.state.isActive()).toBe(true);
  expect(handle.commands.unwrap()).toBe(true);
  expect(handle.state.getAlerts()).toEqual([]);
  expect(nodeNames(editor)).toContain("bullet_list");
  expect(editor.view.state.doc.textContent).toContain("nested");
});

it("supports a node-selected alert for kind and unwrap commands", () => {
  const extension = createAlertsExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "> [!NOTE]\n> Body",
  }));
  const handle = editor.extensions.get(extension);
  editor.view.dispatch(
    editor.view.state.tr.setSelection(NodeSelection.create(editor.view.state.doc, 0)),
  );

  expect(handle.state.getActive()).toEqual({ kind: "note", position: 0 });
  expect(handle.commands.setKind("important")).toBe(true);
  expect(handle.commands.unwrap()).toBe(true);
  expect(editor.getMarkdown()).toBe("Body");
});

it("keeps the editable body DOM stable while changing kind", () => {
  const extension = createAlertsExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "> [!NOTE]\n> Stable body",
  }));
  const handle = editor.extensions.get(extension);
  setTextSelection(editor, 3, 8);
  editor.focus();
  const body = editor.view.dom.querySelector("[data-mdw-alert-body]");
  const selection = { ...editor.view.state.selection.toJSON() };

  expect(handle.commands.setKind("warning")).toBe(true);
  expect(editor.view.dom.querySelector("[data-mdw-alert-body]")).toBe(body);
  expect(editor.view.state.selection.toJSON()).toEqual(selection);
  expect(editor.view.hasFocus()).toBe(true);
});

it("rejects invalid alert kinds in every intermediate raw transaction", () => {
  const errors: Array<{ code?: string; context?: { contribution?: string } }> = [];
  const extension = createAlertsExtension({
    messages: {
      invalidDocumentDiagnostic: (kind) => `Rejected ${kind}`,
    },
  });
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "> [!NOTE]\n> Body",
  }));
  editor.subscribe("error", (event) => errors.push(event));
  const before = editor.getMarkdown();

  editor.view.dispatch(editor.view.state.tr.setNodeMarkup(0, undefined, {
    kind: "danger",
  }));
  expect(editor.getMarkdown()).toBe(before);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatchObject({
    code: "EXTENSION_ALERTS_INVALID_DOCUMENT",
    context: { contribution: "document-invariant" },
  });

  editor.view.dispatch(
    editor.view.state.tr
      .setNodeMarkup(0, undefined, { kind: "DANGER" })
      .setNodeMarkup(0, undefined, { kind: "note" }),
  );
  expect(editor.getMarkdown()).toBe(before);
  expect(errors).toHaveLength(2);

  const alertType = editor.view.state.schema.nodes.alert;
  const paragraph = editor.view.state.schema.nodes.paragraph.create(
    null,
    editor.view.state.schema.text("Invalid"),
  );
  const invalid = alertType.create({ kind: "danger" }, paragraph);
  const insertAt = editor.view.state.doc.content.size;
  editor.view.dispatch(
    editor.view.state.tr
      .insert(insertAt, invalid)
      .delete(insertAt, insertAt + invalid.nodeSize),
  );
  expect(editor.getMarkdown()).toBe(before);
  expect(errors).toHaveLength(3);
});

it("allows ordinary body edits without rescanning unrelated alerts as invalid", () => {
  const extension = createAlertsExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "> [!NOTE]\n> Body\n\n> [!TIP]\n> Other",
  }));
  let bodyEnd = 1;
  editor.view.state.doc.descendants((node, position) => {
    if (node.isText && node.text === "Body") {
      bodyEnd = position + node.nodeSize;
      return false;
    }
    return true;
  });
  setTextSelection(editor, bodyEnd);

  editor.view.dispatch(editor.view.state.tr.insertText(" edited"));
  expect(editor.getMarkdown()).toContain("> Body edited");
  expect(editor.extensions.get(extension).state.getAlerts().map(({ kind }) => kind))
    .toEqual(["note", "tip"]);
});

it("guards read-only, composition, semantic no-ops, and invalid runtime inputs", () => {
  const extension = createAlertsExtension();
  const editor = track(createRootEditor({
    editable: false,
    element: host(),
    extensions: [extension],
    markdown: "Body",
  }));
  const handle = editor.extensions.get(extension);
  const before = editor.getMarkdown();

  expect(handle.commands.wrap()).toBe(false);
  expect(editor.getMarkdown()).toBe(before);
  editor.updateOptions({ editable: true });
  editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  expect(handle.commands.toggle()).toBe(false);
  editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  expect(handle.commands.toggle()).toBe(true);
  expect(() => handle.commands.setKind("danger" as never)).toThrow(
    'Extension command "markora-extension-alerts/setKind" failed.',
  );
  expect(() => handle.state.canWrap("danger" as never)).toThrow(
    'Extension state query "markora-extension-alerts/canWrap" failed.',
  );
});

it("isolates definitions, state, and DOM across simultaneous editors", () => {
  const firstExtension = createAlertsExtension();
  const secondExtension = createAlertsExtension();
  const first = track(createRootEditor({
    element: host(),
    extensions: [firstExtension],
    markdown: "> [!NOTE]\n> First",
  }));
  const second = track(createMinimalEditor({
    element: host(),
    extensions: [secondExtension],
    markdown: "> [!TIP]\n> Second",
  }));

  setTextSelection(first, 2);
  expect(first.extensions.get(firstExtension).commands.setKind("warning")).toBe(true);
  expect(first.extensions.get(firstExtension).state.getAlerts()[0]?.kind).toBe("warning");
  expect(second.extensions.get(secondExtension).state.getAlerts()[0]?.kind).toBe("tip");
  expect(second.getMarkdown()).toBe("> [!TIP]\n> Second");
});

it("renders localized visible kind text and truthful semantic clipboard DOM", () => {
  const extension = createAlertsExtension({
    messages: {
      alertLabel: (_kind, kindLabel) => `Aviso: ${kindLabel}`,
      cautionKindLabel: "Peligro",
      toggleAlert: "Alternar aviso",
    },
  });
  const editor = track(createRootEditor({
    attributes: { dir: "rtl", lang: "es" },
    element: host(),
    extensions: [extension],
    markdown: "> [!CAUTION]\n> Cuerpo",
  }));
  const alert = editor.view.dom.querySelector<HTMLElement>("[data-mdw-alert]")!;
  const header = alert.querySelector<HTMLElement>("[data-mdw-alert-header]")!;
  const body = alert.querySelector<HTMLElement>("[data-mdw-alert-body]")!;

  expect(alert.getAttribute("role")).toBe("note");
  expect(alert.getAttribute("aria-label")).toBe("Aviso: Peligro");
  expect(header.textContent).toBe("Peligro");
  expect(header.getAttribute("contenteditable")).toBe("false");
  expect(body.getAttribute("contenteditable")).toBeNull();
  expect(alert.closest('[dir="rtl"]')).not.toBeNull();
  expect(editor.extensions.uiActions).toContainEqual(expect.objectContaining({
    defaultLabel: "Alternar aviso",
    group: "blocks",
    id: "markora-extension-alerts/toggle",
  }));
});

it("uses canonical alert Markdown for closed whole-alert plain clipboard slices", () => {
  const extension = createAlertsExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "> [!TIP]\n> Body",
  }));
  const position = alertPositions(editor)[0]!;
  editor.view.dispatch(
    editor.view.state.tr.setSelection(NodeSelection.create(editor.view.state.doc, position)),
  );
  const slice = editor.view.state.selection.content();
  let plain: string | undefined;

  editor.view.someProp("clipboardTextSerializer", (serializer) => {
    const value = serializer(slice, editor.view);
    if (value !== undefined) {
      plain = value;
      return true;
    }
    return undefined;
  });

  expect(plain).toBe("> [!TIP]\n> Body");
});

it("keeps a partial body clipboard slice outside the defining alert wrapper", () => {
  const extension = createAlertsExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "> [!WARNING]\n> Clipboard **body**.",
  }));
  let bodyStart = 1;
  editor.view.state.doc.descendants((node, position) => {
    if (node.isText && node.text === "body") {
      bodyStart = position;
      return false;
    }
    return true;
  });
  setTextSelection(editor, bodyStart, bodyStart + 4);

  const serialized = editor.view.serializeForClipboard(
    editor.view.state.selection.content(),
  );
  expect(serialized.slice.content.firstChild?.type.name).toBe("paragraph");
  expect(serialized.slice.content.firstChild?.textContent).toBe("body");
  expect(serialized.dom.innerHTML).toContain("<strong>body</strong>");
  expect(serialized.dom.innerHTML).not.toContain("data-mdw-alert");
});

it("validates and freezes options, messages, kinds, snapshots, and manifests", () => {
  expect(Object.isFrozen(defaultAlertsMessages)).toBe(true);
  expect(Object.isFrozen(alertKinds)).toBe(true);
  expect(() => createAlertsExtension(null as never)).toThrow(TypeError);
  expect(() => createAlertsExtension({ unknown: true } as never)).toThrow(
    'Unknown alert extension option "unknown".',
  );
  expect(() => createAlertsExtension({ messages: [] as never })).toThrow(TypeError);
  expect(() => createAlertsExtension({
    messages: { noteKindLabel: "" },
  })).toThrow(TypeError);
  expect(() => createAlertsExtension({
    messages: { unknown: "Unknown" } as never,
  })).toThrow('Unknown alert message key "unknown".');

  const extension = createAlertsExtension();
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: "> [!NOTE]\n> Body",
  }));
  const alerts = editor.extensions.get(extension).state.getAlerts();
  expect(Object.isFrozen(alerts)).toBe(true);
  expect(Object.isFrozen(alerts[0])).toBe(true);
  expect(Object.isFrozen(editor.extensions.manifest)).toBe(true);
});

it("parses and serializes a large source-only alert workload without renderer state", () => {
  const extension = createAlertsExtension();
  const source = Array.from({ length: 500 }, (_, index) => (
    `> [!${alertKinds[index % alertKinds.length]!.toUpperCase()}]\n> Alert ${index}`
  )).join("\n\n");
  const editor = track(createRootEditor({
    element: host(),
    extensions: [extension],
    markdown: source,
  }));

  expect(editor.extensions.get(extension).state.getAlerts()).toHaveLength(500);
  expect(editor.view.dom.querySelectorAll("[data-mdw-alert]")).toHaveLength(500);
  expect(editor.getMarkdown()).toBe(source);
});
