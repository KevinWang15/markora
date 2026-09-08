import type { MarkdownEditorDomAttributes } from "./editorApi";
import type { EditorView } from "prosemirror-view";

export type EditorDomOptions = {
  ariaLabel: string | null | undefined;
  ariaLabelledBy: string | null | undefined;
  attributes: Record<string, string>;
  editable: boolean;
  placeholder: string | null;
};

export function copyEditorAttributes(
  attributes: MarkdownEditorDomAttributes | null | undefined,
  ownerDocument: Document,
) {
  const copied: Record<string, string> = Object.create(null) as Record<string, string>;
  const probe = ownerDocument.createElement("div");

  for (const [name, value] of Object.entries(attributes ?? {})) {
    const normalizedName = name.toLowerCase();

    if (typeof value !== "string") {
      throw new TypeError(`Editor DOM attribute \"${name}\" must be a string.`);
    }

    if (normalizedName === "nodename" || /^on[a-z]/.test(normalizedName)) {
      throw new RangeError(`Editor DOM attribute \"${name}\" is not supported.`);
    }

    try {
      probe.setAttribute(normalizedName, value);
    } catch {
      throw new RangeError(`Editor DOM attribute name \"${name}\" is invalid.`);
    }

    copied[normalizedName] = value;
  }

  return copied;
}

export function normalizeAccessibleName(value: string | null | undefined, optionName: string) {
  if (value == null) {
    return value;
  }

  if (!value.trim()) {
    throw new RangeError(`${optionName} must not be empty.`);
  }

  return value;
}

export function normalizePlaceholder(value: string | null | undefined) {
  return value ? value : null;
}

export function buildEditorDomAttributes(runtimeOptions: EditorDomOptions) {
  const attributes = { ...runtimeOptions.attributes };

  for (const name of Object.keys(attributes)) {
    if (["aria-placeholder", "aria-readonly", "contenteditable"].includes(name.toLowerCase())) {
      delete attributes[name];
    }
  }

  attributes.role ??= "textbox";
  attributes["aria-multiline"] ??= "true";
  attributes.tabindex ??= "0";
  attributes["aria-readonly"] = runtimeOptions.editable ? "false" : "true";

  if (runtimeOptions.placeholder) {
    attributes["aria-placeholder"] = runtimeOptions.placeholder;
  }

  if (runtimeOptions.ariaLabel === null) {
    delete attributes["aria-label"];
  } else if (runtimeOptions.ariaLabel !== undefined) {
    attributes["aria-label"] = runtimeOptions.ariaLabel;
  }

  if (runtimeOptions.ariaLabelledBy === null) {
    delete attributes["aria-labelledby"];
  } else if (runtimeOptions.ariaLabelledBy !== undefined) {
    attributes["aria-labelledby"] = runtimeOptions.ariaLabelledBy;
  }

  return attributes;
}

export function editorAttributesEqual(
  left: Record<string, string>,
  right: Record<string, string>,
) {
  const leftNames = Object.keys(left);
  const rightNames = Object.keys(right);

  return leftNames.length === rightNames.length
    && leftNames.every((name) => left[name] === right[name]);
}

export function getEditorRootActiveElement(view: EditorView) {
  const root = view.dom.getRootNode();
  const ownerWindow = view.dom.ownerDocument.defaultView;

  if (ownerWindow?.ShadowRoot && root instanceof ownerWindow.ShadowRoot) {
    return root.activeElement ?? view.dom.ownerDocument.activeElement;
  }

  return view.dom.ownerDocument.activeElement;
}

export function isActiveElementInsideEditor(view: EditorView, activeElement: Element | null) {
  return activeElement !== null && view.dom.contains(activeElement);
}

export function blurElement(element: Element | null) {
  if (!element) {
    return;
  }

  const blur = (element as Element & { blur?: unknown }).blur;

  if (typeof blur === "function") {
    blur.call(element);
  }
}

