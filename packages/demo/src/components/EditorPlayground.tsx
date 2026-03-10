import { createEditor, type MarkdownEditor } from "markora";
import { createDefaultUi } from "markora-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { initialMarkdown } from "../lib/content";

type TooltipContent = {
  label: string;
  shortcut?: string;
};

type PopoverControls = {
  panel: HTMLDivElement;
  open: (button: HTMLButtonElement, defaults?: Record<string, string>) => void;
  close: (refocusEditor?: boolean) => void;
  isOpen: () => boolean;
};

const isApplePlatform = (() => {
  if (typeof navigator === "undefined") {
    return false;
  }

  const platform = navigator.platform ?? navigator.userAgent ?? "";
  return /Mac|iPhone|iPad/i.test(platform);
})();

function formatShortcut(shortcut: string) {
  const parts = shortcut.split("+");

  if (isApplePlatform) {
    return parts.map((part) => {
      if (part === "Mod") return "⌘";
      if (part === "Shift") return "⇧";
      if (part === "Alt") return "⌥";
      return part;
    }).join("");
  }

  return parts.map((part) => (part === "Mod" ? "Ctrl" : part)).join("+");
}

function createIcon(paths: string[], options: { viewBox?: string; filled?: boolean } = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", options.viewBox ?? "0 0 24 24");
  svg.setAttribute("fill", options.filled ? "currentColor" : "none");
  svg.setAttribute("stroke", options.filled ? "none" : "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("mdw-toolbar-icon");

  for (const d of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }

  return svg;
}

function createToolbarTooltip() {
  const tooltip = document.createElement("div");
  tooltip.className = "mdw-toolbar-tooltip";
  tooltip.hidden = true;
  tooltip.style.display = "none";
  tooltip.setAttribute("role", "tooltip");

  const label = document.createElement("span");
  label.className = "mdw-toolbar-tooltip-label";

  const shortcut = document.createElement("span");
  shortcut.className = "mdw-toolbar-tooltip-shortcut";

  tooltip.append(label, shortcut);
  document.body.append(tooltip);

  let activeButton: HTMLButtonElement | null = null;
  let showTimer: number | null = null;

  const clearShowTimer = () => {
    if (showTimer !== null) {
      window.clearTimeout(showTimer);
      showTimer = null;
    }
  };

  const reposition = () => {
    if (!activeButton || tooltip.hidden) {
      return;
    }

    const rect = activeButton.getBoundingClientRect();
    const tooltipWidth = tooltip.offsetWidth || 140;
    const tooltipHeight = tooltip.offsetHeight || 36;
    const top = rect.top - tooltipHeight - 10;
    const left = rect.left + rect.width / 2 - tooltipWidth / 2;

    tooltip.style.top = `${Math.max(8, top)}px`;
    tooltip.style.left = `${Math.min(Math.max(8, left), window.innerWidth - tooltipWidth - 8)}px`;
  };

  const hide = () => {
    clearShowTimer();
    activeButton = null;
    tooltip.hidden = true;
    tooltip.style.display = "none";
  };

  const show = (button: HTMLButtonElement, content: TooltipContent) => {
    clearShowTimer();
    activeButton = button;
    showTimer = window.setTimeout(() => {
      label.textContent = content.label;
      shortcut.textContent = content.shortcut ?? "";
      shortcut.hidden = !content.shortcut;
      tooltip.hidden = false;
      tooltip.style.display = "flex";
      reposition();
    }, 120);
  };

  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);

  return {
    tooltip,
    show,
    hide,
    destroy() {
      hide();
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      tooltip.remove();
    },
  };
}

function createToolbarButton(
  tooltipController: ReturnType<typeof createToolbarTooltip>,
  content: string | SVGElement,
  tooltip: TooltipContent,
  onClick: () => void,
  options: { compact?: boolean } = {},
) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mdw-toolbar-button";
  if (options.compact) {
    button.classList.add("mdw-toolbar-button-compact");
  }

  if (typeof content === "string") {
    button.textContent = content;
  } else {
    button.append(content);
  }

  const formattedShortcut = tooltip.shortcut ? formatShortcut(tooltip.shortcut) : undefined;
  const ariaLabel = formattedShortcut ? `${tooltip.label} (${formattedShortcut})` : tooltip.label;
  button.setAttribute("aria-label", ariaLabel);
  button.addEventListener("mouseenter", () => tooltipController.show(button, { ...tooltip, shortcut: formattedShortcut }));
  button.addEventListener("mouseleave", () => tooltipController.hide());
  button.addEventListener("focus", () => tooltipController.show(button, { ...tooltip, shortcut: formattedShortcut }));
  button.addEventListener("blur", () => tooltipController.hide());
  button.addEventListener("click", () => {
    tooltipController.hide();
    onClick();
  });
  return button;
}

function createToolbarGroup(label: string, ...buttons: HTMLButtonElement[]) {
  const group = document.createElement("div");
  group.className = "mdw-toolbar-group";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", label);
  group.append(...buttons);
  return group;
}

function createToolbarPopover(
  editorRef: { current: MarkdownEditor | null },
  options: {
    title: string;
    fields: Array<{ id: string; label: string; placeholder: string }>;
    onSubmit: (values: Record<string, string>) => boolean;
  },
): PopoverControls {
  const panel = document.createElement("div");
  panel.className = "mdw-toolbar-popover";
  panel.hidden = true;
  panel.style.display = "none";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", options.title);

  const heading = document.createElement("div");
  heading.className = "mdw-toolbar-popover-title";
  heading.textContent = options.title;

  const fieldInputs = new Map<string, HTMLInputElement>();

  for (const field of options.fields) {
    const label = document.createElement("label");
    label.className = "mdw-toolbar-popover-field";

    const labelText = document.createElement("span");
    labelText.className = "mdw-toolbar-popover-label";
    labelText.textContent = field.label;

    const input = document.createElement("input");
    input.className = "mdw-toolbar-popover-input";
    input.type = "text";
    input.placeholder = field.placeholder;
    input.setAttribute("autocomplete", field.id === "href" || field.id === "src" ? "url" : "off");
    input.setAttribute("aria-label", field.label);

    label.append(labelText, input);
    panel.append(label);
    fieldInputs.set(field.id, input);
  }

  const actions = document.createElement("div");
  actions.className = "mdw-toolbar-popover-actions";

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "mdw-toolbar-popover-button";
  saveButton.textContent = "Apply";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "mdw-toolbar-popover-button";
  cancelButton.textContent = "Cancel";

  actions.append(saveButton, cancelButton);
  panel.prepend(heading);
  panel.append(actions);
  document.body.append(panel);

  let activeButton: HTMLButtonElement | null = null;

  const reposition = () => {
    if (!activeButton || panel.hidden) {
      return;
    }

    const rect = activeButton.getBoundingClientRect();
    const panelWidth = panel.offsetWidth || 280;
    const panelHeight = panel.offsetHeight || 160;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const preferredTop = rect.bottom + 8;
    const fallbackTop = rect.top - panelHeight - 8;
    const top = preferredTop + panelHeight <= viewportHeight - 12 ? preferredTop : Math.max(12, fallbackTop);
    const left = Math.min(Math.max(12, rect.left), Math.max(12, viewportWidth - panelWidth - 12));

    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
  };

  const close = (refocusEditor = true) => {
    panel.hidden = true;
    panel.style.display = "none";
    activeButton = null;

    if (refocusEditor && editorRef.current) {
      editorRef.current.view.focus();
    }
  };

  const getValues = () => {
    const values: Record<string, string> = {};
    for (const [id, input] of fieldInputs) {
      values[id] = input.value.trim();
    }
    return values;
  };

  saveButton.addEventListener("click", () => {
    if (options.onSubmit(getValues())) {
      close(true);
    }
  });
  cancelButton.addEventListener("click", () => close(true));
  panel.addEventListener("mousedown", (event) => event.preventDefault());
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      saveButton.click();
    }
  });
  document.addEventListener(
    "mousedown",
    (event) => {
      const target = event.target;
      if (!(target instanceof Node) || panel.hidden) {
        return;
      }
      if (panel.contains(target) || activeButton?.contains(target)) {
        return;
      }
      close(false);
    },
    true,
  );
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);

  return {
    panel,
    open(button, defaults = {}) {
      activeButton = button;
      for (const field of options.fields) {
        const input = fieldInputs.get(field.id);
        if (input) {
          input.value = defaults[field.id] ?? "";
        }
      }
      panel.hidden = false;
      panel.style.display = "flex";
      reposition();
      const firstInput = fieldInputs.get(options.fields[0]?.id ?? "");
      firstInput?.focus();
      firstInput?.select();
    },
    close,
    isOpen() {
      return !panel.hidden;
    },
  };
}

export function EditorPlayground() {
  const editorRef = useRef<MarkdownEditor | null>(null);
  const editorElementRef = useRef<HTMLDivElement | null>(null);
  const toolbarElementRef = useRef<HTMLDivElement | null>(null);
  const sourceTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [output, setOutput] = useState(initialMarkdown);

  const notes = useMemo(
    () => [
      "Switch between visual editing and source inspection.",
      "Try tables, links, images, task lists, and fenced code blocks.",
      "The output panel shows the exact serialized Markdown from the editor state.",
    ],
    [],
  );

  useEffect(() => {
    const editorElement = editorElementRef.current;
    const toolbarElement = toolbarElementRef.current;
    const sourceTextarea = sourceTextareaRef.current;

    if (!editorElement || !toolbarElement || !sourceTextarea) {
      return;
    }

    const tooltipController = createToolbarTooltip();
    toolbarElement.setAttribute("role", "toolbar");
    toolbarElement.setAttribute("aria-label", "Formatting");
    toolbarElement.addEventListener("mousedown", (event) => event.preventDefault());

    const linkPopover = createToolbarPopover(editorRef, {
      title: "Add link",
      fields: [{ id: "href", label: "URL", placeholder: "https://example.com" }],
      onSubmit(values) {
        return !!values.href && !!editorRef.current?.commands.setLink(values.href);
      },
    });

    const imagePopover = createToolbarPopover(editorRef, {
      title: "Insert image",
      fields: [
        { id: "src", label: "Image URL", placeholder: "https://example.com/image.png" },
        { id: "alt", label: "Alt text", placeholder: "Describe the image" },
        { id: "title", label: "Title", placeholder: "Optional title" },
      ],
      onSubmit(values) {
        return !!values.src && !!editorRef.current?.commands.insertImage({
          src: values.src,
          alt: values.alt || null,
          title: values.title || null,
        });
      },
    });

    const closeAllPopovers = (refocusEditor = false) => {
      tooltipController.hide();
      linkPopover.close(refocusEditor);
      imagePopover.close(refocusEditor);
    };

    const undoButton = createToolbarButton(tooltipController, createIcon(["M9 14 4 9l5-5", "M4 9h10a6 6 0 1 1 0 12h-1"]), { label: "Undo", shortcut: "Mod+Z" }, () => editorRef.current?.commands.undo(), { compact: true });
    const redoButton = createToolbarButton(tooltipController, createIcon(["m15 14 5-5-5-5", "M20 9H10a6 6 0 1 0 0 12h1"]), { label: "Redo", shortcut: "Shift+Mod+Z" }, () => editorRef.current?.commands.redo(), { compact: true });
    const boldButton = createToolbarButton(tooltipController, createIcon(["M8 6h6a4 4 0 0 1 0 8H8z", "M8 14h7a4 4 0 0 1 0 8H8z", "M8 6v16"]), { label: "Bold", shortcut: "Mod+B" }, () => editorRef.current?.commands.toggleMark("strong"), { compact: true });
    const italicButton = createToolbarButton(tooltipController, createIcon(["M14 4h-4", "M10 20H6", "M14 4 10 20"]), { label: "Italic", shortcut: "Mod+I" }, () => editorRef.current?.commands.toggleMark("em"), { compact: true });
    const codeButton = createToolbarButton(tooltipController, createIcon(["m9 18-6-6 6-6", "m15 6 6 6-6 6", "M14 4 10 20"]), { label: "Inline code", shortcut: "Mod+E" }, () => editorRef.current?.commands.toggleMark("code"), { compact: true });
    const strikeButton = createToolbarButton(tooltipController, createIcon(["M5 12h14", "M8 6h5a3 3 0 0 1 0 6H11a3 3 0 0 0 0 6h5"]), { label: "Strike", shortcut: "Mod+Shift+X" }, () => editorRef.current?.commands.toggleMark("strike"), { compact: true });

    const linkButton = createToolbarButton(
      tooltipController,
      createIcon(["M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4", "M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L13 19"]),
      { label: "Add or edit link" },
      () => {
        const editor = editorRef.current;
        if (editor?.state.isActive.mark("link")) {
          closeAllPopovers(false);
          editor.ui?.editLink();
          return;
        }
        imagePopover.close(false);
        linkPopover.open(linkButton, { href: "https://example.com" });
      },
      { compact: true },
    );
    const unlinkButton = createToolbarButton(tooltipController, createIcon(["M4 12h16", "m8 8-8-8", "m8 8-8 8"], { viewBox: "0 0 16 16" }), { label: "Remove link" }, () => editorRef.current?.commands.removeLink(), { compact: true });
    unlinkButton.classList.add("mdw-toolbar-button-secondary");

    const imageButton = createToolbarButton(
      tooltipController,
      createIcon(["M4 5h16v14H4z", "m4 15 4-4 3 3 5-6 4 5", "M9 9h.01"]),
      { label: "Insert or edit image" },
      () => {
        const editor = editorRef.current;
        if (editor?.state.isActive.node("image")) {
          closeAllPopovers(false);
          editor.ui?.editImage();
          return;
        }
        linkPopover.close(false);
        imagePopover.open(imageButton, { src: "https://example.com/image.png", alt: "", title: "" });
      },
      { compact: true },
    );
    const removeImageButton = createToolbarButton(tooltipController, createIcon(["M5 6h14", "M9 6V4h6v2", "M8 6l1 12h6l1-12", "M10 10v5", "M14 10v5"]), { label: "Remove image" }, () => editorRef.current?.commands.removeImage(), { compact: true });
    removeImageButton.classList.add("mdw-toolbar-button-secondary");

    toolbarElement.append(
      createToolbarGroup("History", undoButton, redoButton),
      createToolbarGroup("Formatting", boldButton, italicButton, codeButton, strikeButton),
      createToolbarGroup("Links", linkButton, unlinkButton),
      createToolbarGroup("Images", imageButton, removeImageButton),
    );

    const setButtonState = (button: HTMLButtonElement, state: { enabled: boolean; active?: boolean }) => {
      button.disabled = !state.enabled;
      button.classList.toggle("is-active", state.active === true);
    };

    const renderToolbar = () => {
      const editor = editorRef.current;

      if (!editor) {
        return;
      }

      const boldState = {
        active: editor.state.isActive.mark("strong"),
        enabled: editor.state.can.toggleMark("strong"),
      };
      const italicState = {
        active: editor.state.isActive.mark("em"),
        enabled: editor.state.can.toggleMark("em"),
      };
      const codeState = {
        active: editor.state.isActive.mark("code"),
        enabled: editor.state.can.toggleMark("code"),
      };
      const strikeState = {
        active: editor.state.isActive.mark("strike"),
        enabled: editor.state.can.toggleMark("strike"),
      };
      const linkActive = editor.state.isActive.mark("link");
      const linkState = {
        active: linkActive,
        enabled: linkActive || editor.state.can.setLink(),
      };
      const imageActive = editor.state.isActive.node("image");
      const imageState = {
        active: imageActive,
        enabled: imageActive || editor.state.can.insertImage(),
      };

      setButtonState(boldButton, boldState);
      setButtonState(italicButton, italicState);
      setButtonState(codeButton, codeState);
      setButtonState(strikeButton, strikeState);
      setButtonState(linkButton, linkState);
      setButtonState(imageButton, imageState);
      undoButton.disabled = !editor.state.can.undo();
      redoButton.disabled = !editor.state.can.redo();
      unlinkButton.disabled = !linkState.active;
      removeImageButton.disabled = !imageState.active;
      if (!linkState.enabled && linkPopover.isOpen()) {
        linkPopover.close(false);
      }
      if (!imageState.enabled && imagePopover.isOpen()) {
        imagePopover.close(false);
      }
    };

    const editor = createEditor({
      element: editorElement,
      markdown: initialMarkdown,
      onChangeMode: "animationFrame",
      ui: createDefaultUi(),
      onTransaction() {
        closeAllPopovers(false);
        renderToolbar();
      },
      onChange(markdown) {
        setOutput(markdown);
      },
    });

    editorRef.current = editor;
    sourceTextarea.value = initialMarkdown;
    setOutput(editor.getMarkdown());
    renderToolbar();

    const applyMarkdown = () => {
      if (!editorRef.current || !sourceTextareaRef.current) {
        return;
      }
      editorRef.current.commands.setMarkdown(sourceTextareaRef.current.value);
      editorRef.current.flushChange();
      renderToolbar();
    };

    const closeFromMouse = () => closeAllPopovers(false);
    const closeFromFocus = () => closeAllPopovers(false);

    editorElement.addEventListener("mousedown", closeFromMouse);
    sourceTextarea.addEventListener("focus", closeFromFocus);

    const applyButton = document.getElementById("apply-markdown-button");
    applyButton?.addEventListener("focus", closeFromFocus);
    applyButton?.addEventListener("click", applyMarkdown);

    return () => {
      applyButton?.removeEventListener("focus", closeFromFocus);
      applyButton?.removeEventListener("click", applyMarkdown);
      sourceTextarea.removeEventListener("focus", closeFromFocus);
      editorElement.removeEventListener("mousedown", closeFromMouse);
      editor.destroy();
      editorRef.current = null;
      toolbarElement.innerHTML = "";
      tooltipController.destroy();
      linkPopover.panel.remove();
      imagePopover.panel.remove();
    };
  }, []);

  return (
    <div className="playground-shell">
      <div className="playground-intro">
        <div>
          <span className="eyebrow">Interactive demo</span>
          <h1>See the editing model, not just screenshots.</h1>
          <p>
            This playground wires the published `markora` package directly into a docs-style React shell,
            so what you test here mirrors how you would host it in a real app.
          </p>
        </div>
        <ul className="check-list">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>

      <div className="playground-layout">
        <section className="panel panel-editor">
          <div className="panel-header">
            <h3>Visual editor</h3>
            <p>Use the toolbar or type directly into the document.</p>
          </div>
          <div ref={toolbarElementRef} className="mdw-toolbar" />
          <div ref={editorElementRef} id="editor" />
        </section>

        <section className="panel panel-source">
          <div className="panel-header">
            <h3>Markdown source</h3>
            <p>Paste markdown, then push it into the editor.</p>
          </div>
          <textarea ref={sourceTextareaRef} id="source" spellCheck={false} defaultValue={initialMarkdown} />
          <div className="source-actions">
            <button id="apply-markdown-button" type="button" className="button button-primary">Apply Markdown</button>
          </div>
        </section>
      </div>

      <section className="panel panel-output">
        <div className="panel-header">
          <h3>Serialized output</h3>
          <p>See the Markdown generated by the current document state.</p>
        </div>
        <pre id="output">{output}</pre>
      </section>
    </div>
  );
}
