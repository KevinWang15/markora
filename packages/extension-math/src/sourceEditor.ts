import { MATH_MAX_SOURCE_BYTES } from "./source";

/** Native input owns selection, clipboard and IME; a non-interactive mirror adds
 * TeX highlighting without a second contenteditable surface or editor runtime. */
export function highlightTex(
  source: string,
  document: Document,
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  if (source.length > MATH_MAX_SOURCE_BYTES) {
    fragment.append(source);
    return fragment;
  }
  const tokens =
    /(%[^\n]*|\\(?:[a-zA-Z]+|[^\r\n])|[{}[\]]|[\^_&]|\d+(?:\.\d+)?)/g;
  let offset = 0;
  for (const match of source.matchAll(tokens)) {
    fragment.append(source.slice(offset, match.index));
    const token = document.createElement("span");
    const value = match[0];
    token.className = `mdw-tex-${value[0] === "%" ? "comment" : value[0] === "\\" ? "command" : /^[\d]/.test(value) ? "number" : "punctuation"}`;
    token.textContent = value;
    fragment.append(token);
    offset = match.index + value.length;
  }
  fragment.append(source.slice(offset));
  return fragment;
}

export type MathSourceEditor = ReturnType<typeof createMathSourceEditor>;

export function createMathSourceEditor(options: {
  document: Document;
  source: string;
  inline: boolean;
  label: string;
  hint: string;
  onChange(source: string): void;
  onExit(direction: -1 | 1 | null): void;
}) {
  const { document } = options;
  const dom = document.createElement("span");
  dom.className = "mdw-math__editor";
  dom.dir = "ltr";
  const mirror = document.createElement("span");
  mirror.className = "mdw-math__highlight";
  mirror.setAttribute("aria-hidden", "true");
  const input = document.createElement("textarea");
  input.className = "mdw-math__input";
  input.setAttribute("aria-label", options.label);
  input.setAttribute("aria-description", options.hint);
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("autocorrect", "off");
  input.rows = options.inline ? 1 : 3;
  input.placeholder = "\\frac{a}{b}";
  input.value = options.source;
  dom.append(mirror, input);
  let composing = false;
  let destroyed = false;
  const paint = () => {
    mirror.replaceChildren(highlightTex(input.value + "\n", document));
    // Both layers share identical metrics and wrapping; height is bounded in CSS.
    input.style.height = "0px";
    input.style.height = `${Math.max(input.scrollHeight, options.inline ? 32 : 80)}px`;
    mirror.scrollTop = input.scrollTop;
    mirror.scrollLeft = input.scrollLeft;
  };
  const change = () => {
    paint();
    if (!composing) options.onChange(input.value);
  };
  const compositionStart = () => {
    composing = true;
  };
  const compositionEnd = () => {
    composing = false;
    change();
    if (
      !destroyed &&
      input.getRootNode() &&
      (input.getRootNode() as Document | ShadowRoot).activeElement !== input
    )
      options.onExit(null);
  };
  const keydown = (event: KeyboardEvent) => {
    if (composing || event.isComposing || event.keyCode === 229) return;
    const caret = input.selectionStart === input.selectionEnd;
    let direction: -1 | 1 | null | undefined;
    if (event.key === "Escape") direction = null;
    else if (event.key === "Tab") direction = event.shiftKey ? -1 : 1;
    else if (
      event.key === "Enter" &&
      (options.inline || event.ctrlKey || event.metaKey)
    )
      direction = 1;
    else if (
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      caret
    ) {
      if (event.key === "ArrowUp" && input.selectionStart === 0) direction = -1;
      if (
        event.key === "ArrowDown" &&
        input.selectionEnd === input.value.length
      )
        direction = 1;
    }
    if (direction !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      options.onExit(direction);
    }
  };
  const blur = () => {
    if (!composing && !destroyed) options.onExit(null);
  };
  const scroll = () => {
    mirror.scrollTop = input.scrollTop;
    mirror.scrollLeft = input.scrollLeft;
  };
  let width = 0;
  const ResizeObserverClass = document.defaultView?.ResizeObserver;
  const observer = ResizeObserverClass
    ? new ResizeObserverClass((entries) => {
        const nextWidth = entries[0]?.contentRect.width ?? 0;
        if (nextWidth !== width && !destroyed) {
          width = nextWidth;
          paint();
        }
      })
    : null;
  observer?.observe(dom);
  input.addEventListener("input", change);
  input.addEventListener("compositionstart", compositionStart);
  input.addEventListener("compositionend", compositionEnd);
  input.addEventListener("keydown", keydown);
  input.addEventListener("blur", blur);
  input.addEventListener("scroll", scroll);
  return {
    dom,
    input,
    get composing() {
      return composing;
    },
    focus() {
      input.focus({ preventScroll: true });
      paint();
      input.select();
    },
    sync(source: string) {
      if (input.value === source) return;
      const start = input.selectionStart,
        end = input.selectionEnd;
      input.value = source;
      paint();
      input.setSelectionRange(start, end);
    },
    destroy() {
      destroyed = true;
      observer?.disconnect();
      input.removeEventListener("input", change);
      input.removeEventListener("compositionstart", compositionStart);
      input.removeEventListener("compositionend", compositionEnd);
      input.removeEventListener("keydown", keydown);
      input.removeEventListener("blur", blur);
      input.removeEventListener("scroll", scroll);
      dom.remove();
    },
  };
}
