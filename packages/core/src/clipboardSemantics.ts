import { Fragment, Slice, type Node as ProseMirrorNode } from "prosemirror-model";
import { closeHistory } from "prosemirror-history";
import { Plugin, type Command, type Selection, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { MarkdownEditorCodec } from "./markdownCodec";

const MARKDOWN_MIME = "text/markdown";
const LEGACY_MARKDOWN_MIME = "text/x-markdown";

type ClipboardSemanticsOptions = {
  codec: MarkdownEditorCodec;
  reportBrowserError: (error: unknown) => void;
  tableClipboard?: TableClipboardAdapter | null;
  takeExtensionFailure: () => unknown | null;
};

export type TableClipboardSelection = Readonly<{
  markdownDocument: ProseMirrorNode;
  rows: readonly (readonly ProseMirrorNode[])[];
}>;

export type TableClipboardAdapter = Readonly<{
  clearSelection: (transaction: Transaction) => Transaction;
  readSelection: (selection: Selection) => TableClipboardSelection | null;
  reportError?: (error: unknown) => void;
}>;

function readData(data: DataTransfer, type: string) {
  try {
    return data.getData(type);
  } catch {
    return "";
  }
}

function readMarkdown(data: DataTransfer) {
  return readData(data, MARKDOWN_MIME) || readData(data, LEGACY_MARKDOWN_MIME);
}

function childText(node: ProseMirrorNode, separator: string, depth: number) {
  const values: string[] = [];
  node.forEach((child) => values.push(plainText(child, depth)));
  return values.join(separator);
}

function listText(node: ProseMirrorNode, depth: number) {
  const ordered = node.type.name === "ordered_list";
  const start = typeof node.attrs.order === "number" ? node.attrs.order : 1;
  const indent = "  ".repeat(depth);
  const items: string[] = [];

  node.forEach((item, _offset, index) => {
    const blocks: string[] = [];
    item.forEach((child) => {
      blocks.push(
        child.type.name === "bullet_list" || child.type.name === "ordered_list"
          ? listText(child, depth + 1)
          : plainText(child, depth + 1),
      );
    });
    const checked = typeof item.attrs.checked === "boolean"
      ? `[${item.attrs.checked ? "x" : " "}] `
      : "";
    const marker = ordered ? `${start + index}. ` : "- ";
    const first = blocks.shift() ?? "";
    const continuation = blocks
      .filter(Boolean)
      .map((value) => value.startsWith(" ") ? value : `${indent}  ${value}`)
      .join("\n");
    items.push(`${indent}${marker}${checked}${first}${continuation ? `\n${continuation}` : ""}`);
  });

  return items.join("\n");
}

function plainText(node: ProseMirrorNode, depth = 0): string {
  if (node.isText) {
    return node.text ?? "";
  }

  switch (node.type.name) {
    case "hard_break":
      return "\n";
    case "image":
      return typeof node.attrs.alt === "string" && node.attrs.alt
        ? node.attrs.alt
        : typeof node.attrs.src === "string" ? node.attrs.src : "";
    case "horizontal_rule":
      return "---";
    case "code_block":
      return node.textContent;
    case "paragraph":
    case "heading":
      return childText(node, "", depth);
    case "bullet_list":
    case "ordered_list":
      return listText(node, depth);
    case "blockquote":
      return childText(node, "\n\n", depth)
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "table":
      return childText(node, "\n", depth);
    case "table_row":
      return childText(node, "\t", depth);
    case "table_cell":
    case "table_header":
      return childText(node, " ", depth);
    default:
      if (node.isLeaf) {
        return node.type.spec.leafText?.(node) ?? "";
      }
      return childText(node, node.isBlock ? "\n\n" : "", depth);
  }
}

function quoteTsvCell(value: string) {
  return /[\t\r\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function tableSelectionText(selection: TableClipboardSelection) {
  return selection.rows
    .map((row) => row.map((cell) => quoteTsvCell(plainText(cell))).join("\t"))
    .join("\n");
}

function documentForSlice(codec: MarkdownEditorCodec, slice: Slice) {
  return codec.schema.topNodeType.create(null, slice.content);
}

const clipboardBlockElement = /^(?:ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DIV|H[1-6]|HEADER|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TR|UL)$/;

export function htmlClipboardToText(ownerDocument: Document, html: string) {
  const template = ownerDocument.createElement("template");
  template.innerHTML = html;

  const readNode = (node: Node): string => {
    if (node.nodeType === 3) return node.nodeValue ?? "";
    if (node.nodeType !== 1 && node.nodeType !== 11) return "";
    if (node.nodeName === "BR") return "\n";

    let value = "";
    for (const child of node.childNodes) value += readNode(child);
    return clipboardBlockElement.test(node.nodeName) && value && !value.endsWith("\n")
      ? `${value}\n`
      : value;
  };

  return readNode(template.content).replace(/\n$/, "");
}

export function nestedClipboardText(
  ownerDocument: Document,
  data: DataTransfer,
  transformHtml?: ((html: string) => string) | null,
  transformText?: ((text: string) => string) | null,
  delegatePlain = false,
) {
  const html = readData(data, "text/html");
  const plain = readData(data, "text/plain") || readData(data, "Text");
  const markdown = readMarkdown(data);
  let text = "";

  if (html && transformHtml) {
    const transformed = transformHtml(html);
    if (transformed !== html) {
      text = htmlClipboardToText(ownerDocument, transformed);
      if (!text) return "";
    }
  }

  if (!text) {
    if (plain) {
      if (delegatePlain) return null;
      text = plain;
    } else {
      if (!html && !markdown) return null;
      text = markdown || htmlClipboardToText(ownerDocument, html);
    }
  }

  return transformText ? transformText(text) : text;
}

export function isolateClipboardHistory(transaction: Transaction) {
  return closeHistory(transaction).setTime(0);
}

function applyTextTransforms(view: EditorView, initial: string, plain: boolean) {
  let value = initial;
  view.someProp("transformPastedText", (transform) => {
    value = transform(value, plain, view);
    return view.isDestroyed || undefined;
  });
  return value;
}

function applySliceTransforms(view: EditorView, initial: Slice, plain: boolean) {
  let value = initial;
  view.someProp("transformPasted", (transform) => {
    value = transform(value, view, plain);
    return view.isDestroyed || undefined;
  });
  return value;
}

function plainSlice(view: EditorView, source: string, checkFailure: () => void) {
  const text = applyTextTransforms(view, source, true).replace(/\r\n?/g, "\n");
  checkFailure();

  if (!text || view.isDestroyed) {
    return null;
  }

  if (view.state.selection.$from.parent.type.spec.code) {
    const slice = applySliceTransforms(
      view,
      new Slice(Fragment.from(view.state.schema.text(text)), 0, 0),
      true,
    );
    checkFailure();
    return view.isDestroyed ? null : slice;
  }

  const paragraph = view.state.schema.nodes.paragraph;
  const marks = view.state.selection.$from.marks();

  if (!paragraph) {
    return null;
  }

  const blocks = text.split(/\n+/).map((block) => paragraph.create(
    null,
    block ? view.state.schema.text(block, marks) : undefined,
  ));
  const slice = applySliceTransforms(
    view,
    Slice.maxOpen(Fragment.fromArray(blocks), true),
    true,
  );
  checkFailure();
  return view.isDestroyed ? null : slice;
}

function markdownSlice(
  view: EditorView,
  codec: MarkdownEditorCodec,
  source: string,
  checkFailure: () => void,
) {
  if (view.state.selection.$from.parent.type.spec.code || !source.trim()) {
    return plainSlice(view, source, checkFailure);
  }

  const markdown = applyTextTransforms(view, source, false).replace(/\r\n?/g, "\n");
  checkFailure();

  if (!markdown || view.isDestroyed) {
    return null;
  }

  const doc = codec.parse(markdown);

  if (!doc || view.isDestroyed) {
    return null;
  }

  const first = doc.childCount === 1 ? doc.firstChild : null;
  const slice = first?.type === codec.schema.nodes.paragraph
    ? new Slice(first.content, 0, 0)
    : new Slice(doc.content, 0, 0);
  const transformed = applySliceTransforms(view, slice, false);
  checkFailure();
  return view.isDestroyed ? null : transformed;
}

function insertSlice(
  view: EditorView,
  slice: Slice | null,
  dispatch: (transaction: Transaction) => void = view.dispatch.bind(view),
) {
  if (!slice || slice.size === 0 || view.isDestroyed) {
    return false;
  }

  dispatch(isolateClipboardHistory(
    view.state.tr
      .replaceSelection(slice)
      .scrollIntoView()
      .setMeta("paste", true)
      .setMeta("uiEvent", "paste"),
  ));
  return true;
}

function insertBrowserPaste(view: EditorView, event: ClipboardEvent, slice: Slice | null) {
  if (!slice || slice.size === 0) {
    event.preventDefault();
    return true;
  }

  let handled = false;
  view.someProp("handlePaste", (handler) => {
    if (handler(view, event, slice)) {
      handled = true;
      return true;
    }
    return undefined;
  });

  if (view.isDestroyed) {
    event.preventDefault();
    return true;
  }

  if (!handled && !event.defaultPrevented) {
    handled = insertSlice(view, slice);
  }

  if (handled || event.defaultPrevented) {
    event.preventDefault();
    return true;
  }

  return false;
}

function assertClipboardText(value: string, name: string) {
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string.`);
  }
}

export function createClipboardSemantics(options: ClipboardSemanticsOptions) {
  const { codec, reportBrowserError, tableClipboard, takeExtensionFailure } = options;
  let shiftKey = false;
  let lastKeyCode = 0;
  const throwExtensionFailure = () => {
    const failure = takeExtensionFailure();
    if (failure) throw failure;
  };

  const pasteMarkdown = (markdown: string): Command => {
    assertClipboardText(markdown, "Markdown to paste");
    return (_state, dispatch, view) => {
      if (!view || !markdown || !dispatch) {
        return Boolean(view && markdown);
      }
      const slice = markdownSlice(view, codec, markdown, throwExtensionFailure);
      return insertSlice(view, slice, dispatch);
    };
  };
  const pastePlainText = (text: string): Command => {
    assertClipboardText(text, "Plain text to paste");
    return (_state, dispatch, view) => {
      if (!view || !text || !dispatch) {
        return Boolean(view && text);
      }
      const slice = plainSlice(view, text, throwExtensionFailure);
      return insertSlice(view, slice, dispatch);
    };
  };

  const handleCopy = (view: EditorView, event: ClipboardEvent) => {
    const state = view.state;
    const { selection } = state;

    if (selection.empty || !event.clipboardData) {
      return false;
    }

    let serialized: ReturnType<EditorView["serializeForClipboard"]>;
    let tableSelection: TableClipboardSelection | null = null;
    let tableSelectionReadFailed = false;

    try {
      serialized = view.serializeForClipboard(selection.content());
    } catch (error) {
      reportBrowserError(error);
      event.preventDefault();
      return true;
    }

    try {
      tableSelection = tableClipboard?.readSelection(selection) ?? null;
    } catch (error) {
      // HTML and ordinary text are still useful fidelity representations for
      // a host-provided table shape that GFM cannot encode. Report the gap,
      // omit Markdown, and never mutate the unsupported selection on cut.
      tableSelectionReadFailed = true;
      (tableClipboard?.reportError ?? reportBrowserError)(error);
    }

    if (view.isDestroyed) {
      event.preventDefault();
      return true;
    }

    try {
      event.clipboardData.clearData();
      event.clipboardData.setData("text/html", serialized.dom.innerHTML);
      event.clipboardData.setData(
        "text/plain",
        tableSelection ? tableSelectionText(tableSelection) : serialized.text,
      );
    } catch {
      event.preventDefault();
      return true;
    }

    let markdown: string | null = null;

    if (!tableSelectionReadFailed) {
      try {
        markdown = codec.serialize(
          tableSelection?.markdownDocument ?? documentForSlice(codec, serialized.slice),
        );
      } catch (error) {
        reportBrowserError(error);
      }
    }

    if (markdown != null) {
      try {
        event.clipboardData.setData(MARKDOWN_MIME, markdown);
      } catch {
        // Custom MIME writes are optional. HTML and plain text still interoperate.
      }
    }

    event.preventDefault();

    if (
      event.type === "cut"
      && !tableSelectionReadFailed
      && view.editable
      && !view.isDestroyed
      && view.state === state
    ) {
      try {
        const transaction = tableSelection && tableClipboard
          ? tableClipboard.clearSelection(view.state.tr)
          : view.state.tr.deleteSelection();
        view.dispatch(isolateClipboardHistory(
          transaction
            .scrollIntoView()
            .setMeta("uiEvent", "cut"),
        ));
      } catch (error) {
        reportBrowserError(error);
      }
    }

    return true;
  };

  const plugin = new Plugin({
    props: {
      clipboardTextSerializer(slice) {
        return plainText(documentForSlice(codec, slice));
      },
      handleDOMEvents: {
        blur() {
          shiftKey = false;
          lastKeyCode = 0;
          return false;
        },
        copy: handleCopy,
        cut: handleCopy,
        keydown(_view, event) {
          shiftKey = event.shiftKey;
          lastKeyCode = event.keyCode;
          return false;
        },
        keyup(_view, event) {
          shiftKey = event.shiftKey;
          return false;
        },
        paste(view, event) {
          if (!view.editable || view.composing || !event.clipboardData) {
            return false;
          }

          const data = event.clipboardData;
          const markdown = readMarkdown(data);
          const plain = readData(data, "text/plain") || readData(data, "Text");
          const html = readData(data, "text/html");
          const preferPlain = shiftKey && lastKeyCode !== 45;
          const inCode = Boolean(view.state.selection.$from.parent.type.spec.code);

          if (preferPlain || inCode) {
            if (plain) {
              return false;
            }

            try {
              const slice = plainSlice(
                view,
                markdown || (html ? htmlClipboardToText(view.dom.ownerDocument, html) : ""),
                throwExtensionFailure,
              );
              return insertBrowserPaste(view, event, slice);
            } catch (error) {
              reportBrowserError(error);
              event.preventDefault();
              return true;
            }
          }

          if (html || !markdown) {
            return false;
          }

          try {
            const slice = markdownSlice(view, codec, markdown, throwExtensionFailure);
            return insertBrowserPaste(view, event, slice);
          } catch (error) {
            reportBrowserError(error);
            event.preventDefault();
            return true;
          }
        },
      },
    },
  });

  return Object.freeze({ pasteMarkdown, pastePlainText, plugin });
}
