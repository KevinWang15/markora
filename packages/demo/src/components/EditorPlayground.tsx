import {
  Bold,
  Code2,
  ImageOff,
  ImagePlus,
  Italic,
  Link2,
  Link2Off,
  Redo2,
  Strikethrough,
  Sigma,
  Undo2,
  type LucideIconData,
} from "@lucide/icons";
import { buildLucideIconElement } from "@lucide/icons/build";
import { createEditor, type MarkdownEditor } from "markora";
import { createMathExtension, type MathKind } from "markora-extension-math";
import { MathDialog, type MathEdit } from "@markora/react-ui/MathDialog";
import { createMathContextMenuProvider } from "@markora/react-ui/mathContextMenu";
import { renderMath } from "@markora/react-ui/renderMath";
import "markora-extension-math/styles.css";
import "@markora/react-ui/styles.css";
import { createDefaultUi } from "markora-ui";
import { useEffect, useRef, useState } from "react";
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
  destroy: () => void;
};

const isApplePlatform = (() => {
  if (typeof navigator === "undefined") {
    return false;
  }

  const platform = navigator.platform ?? navigator.userAgent ?? "";
  return /Mac|iPhone|iPad/i.test(platform);
})();

type PlaygroundRouteSession = Readonly<{
  editorMarkdown: string;
  sourceMarkdown: string;
  sourceDirty: boolean;
}>;

// Preserve route history work without writing authored content to durable browser storage.
let playgroundRouteSession: PlaygroundRouteSession = Object.freeze({
  editorMarkdown: initialMarkdown,
  sourceMarkdown: initialMarkdown,
  sourceDirty: false,
});

function rememberPlaygroundRouteSession(session: PlaygroundRouteSession) {
  playgroundRouteSession = Object.freeze(session);
}

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

function createToolbarIcon(icon: LucideIconData) {
  return buildLucideIconElement(document, icon, {
    className: "mdw-toolbar-icon",
    size: 18,
    strokeWidth: 1.8,
    attributes: {
      "aria-hidden": "true",
      focusable: "false",
    },
  });
}

function createToolbarTooltip() {
  const tooltip = document.createElement("div");
  tooltip.className = "mdw-toolbar-tooltip";
  tooltip.hidden = true;
  tooltip.style.display = "none";
  tooltip.setAttribute("aria-hidden", "true");

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
  content: string | Element,
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

function createToolbarKeyboardNavigation(toolbar: HTMLElement) {
  let tabStop: HTMLButtonElement | null = null;

  const getButtons = () => Array.from(toolbar.querySelectorAll<HTMLButtonElement>("button"));
  const getEnabledButtons = () => getButtons().filter((button) => !button.disabled);
  const setTabStop = (nextTabStop: HTMLButtonElement | null) => {
    tabStop = nextTabStop;
    for (const button of getButtons()) {
      button.tabIndex = button === tabStop ? 0 : -1;
    }
  };
  const refresh = () => {
    const enabledButtons = getEnabledButtons();
    setTabStop(tabStop && enabledButtons.includes(tabStop) ? tabStop : enabledButtons[0] ?? null);
  };
  const handleFocusIn = (event: FocusEvent) => {
    const button = event.target;
    if (button instanceof HTMLButtonElement && toolbar.contains(button) && !button.disabled) {
      setTabStop(button);
    }
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    const button = event.target;
    if (!(button instanceof HTMLButtonElement) || !toolbar.contains(button)) {
      return;
    }

    const enabledButtons = getEnabledButtons();
    const currentIndex = enabledButtons.indexOf(button);
    if (currentIndex < 0 || enabledButtons.length === 0) {
      return;
    }

    const direction = getComputedStyle(toolbar).direction;
    let nextIndex: number | null = null;
    if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = enabledButtons.length - 1;
    } else if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + (direction === "rtl" ? -1 : 1) + enabledButtons.length)
        % enabledButtons.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex + (direction === "rtl" ? 1 : -1) + enabledButtons.length)
        % enabledButtons.length;
    } else if (event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % enabledButtons.length;
    } else if (event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + enabledButtons.length) % enabledButtons.length;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextButton = enabledButtons[nextIndex];
    setTabStop(nextButton);
    nextButton?.focus();
  };

  toolbar.setAttribute("aria-orientation", "horizontal");
  toolbar.addEventListener("focusin", handleFocusIn);
  toolbar.addEventListener("keydown", handleKeyDown);
  refresh();

  return {
    refresh,
    destroy() {
      toolbar.removeEventListener("focusin", handleFocusIn);
      toolbar.removeEventListener("keydown", handleKeyDown);
    },
  };
}

function createToolbarPopover(
  editorRef: { current: MarkdownEditor | null },
  options: {
    title: string;
    fields: Array<{ id: string; label: string; placeholder: string }>;
    validationMessage: string;
    onSubmit: (values: Record<string, string>) => boolean;
  },
): PopoverControls {
  const panel = document.createElement("div");
  panel.className = "mdw-toolbar-popover";
  panel.id = `mdw-toolbar-popover-${options.fields.map(({ id }) => id).join("-")}`;
  panel.hidden = true;
  panel.style.display = "none";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-label", options.title);

  const heading = document.createElement("div");
  heading.className = "mdw-toolbar-popover-title";
  heading.textContent = options.title;

  const body = document.createElement("div");
  body.className = "mdw-toolbar-popover-body";
  panel.append(body);

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
    body.append(label);
    fieldInputs.set(field.id, input);
  }

  const actions = document.createElement("div");
  actions.className = "mdw-toolbar-popover-actions";

  const validationError = document.createElement("p");
  const validationErrorId = `mdw-toolbar-popover-error-${options.fields.map(({ id }) => id).join("-")}`;
  validationError.id = validationErrorId;
  validationError.className = "mdw-toolbar-popover-error";
  validationError.setAttribute("role", "alert");
  validationError.hidden = true;

  const clearValidation = () => {
    validationError.hidden = true;
    validationError.textContent = "";
    for (const input of fieldInputs.values()) {
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
    }
  };

  for (const input of fieldInputs.values()) {
    input.addEventListener("input", clearValidation);
  }

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "mdw-toolbar-popover-button";
  saveButton.textContent = "Apply";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "mdw-toolbar-popover-button";
  cancelButton.textContent = "Cancel";

  actions.append(saveButton, cancelButton);
  body.prepend(heading);
  body.append(validationError, actions);
  document.body.append(panel);

  let activeButton: HTMLButtonElement | null = null;

  const clamp = (value: number, min: number, max: number) => (
    Math.min(Math.max(value, min), max)
  );

  const reposition = () => {
    if (!activeButton || panel.hidden) {
      return;
    }

    const rect = activeButton.getBoundingClientRect();
    const visualViewport = window.visualViewport;
    const viewportLeft = visualViewport?.offsetLeft ?? 0;
    const viewportTop = visualViewport?.offsetTop ?? 0;
    const viewportWidth = visualViewport?.width || document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = visualViewport?.height || document.documentElement.clientHeight || window.innerHeight;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const availableWidth = Math.max(0, viewportWidth - 24);
    const availableHeight = Math.max(0, viewportHeight - 24);

    panel.style.maxWidth = `${availableWidth}px`;
    panel.style.maxHeight = `${availableHeight}px`;

    const panelRect = panel.getBoundingClientRect();
    const panelWidth = Math.min(panelRect.width || panel.offsetWidth || 280, availableWidth);
    const panelHeight = Math.min(panelRect.height || panel.offsetHeight || 160, availableHeight);
    const minLeft = viewportLeft + 12;
    const maxLeft = Math.max(minLeft, viewportRight - panelWidth - 12);
    const left = clamp(rect.left, minLeft, maxLeft);
    const topBelow = rect.bottom + 8;
    const topAbove = rect.top - panelHeight - 8;
    const belowFits = topBelow + panelHeight <= viewportBottom - 12;
    const aboveFits = topAbove >= viewportTop + 12;
    const side = belowFits || (!aboveFits && viewportBottom - rect.bottom >= rect.top - viewportTop)
      ? "below"
      : "above";
    const preferredTop = side === "below" ? topBelow : topAbove;
    const minTop = viewportTop + 12;
    const maxTop = Math.max(minTop, viewportBottom - panelHeight - 12);
    const top = clamp(preferredTop, minTop, maxTop);
    const arrowLeft = clamp(rect.left + rect.width / 2 - left - 6, 12, Math.max(12, panelWidth - 24));

    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
    panel.style.setProperty("--mdw-toolbar-popover-arrow-left", `${arrowLeft}px`);
    panel.dataset.side = side;

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && panel.contains(activeElement)) {
      activeElement.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };

  const close = (refocusEditor = true) => {
    activeButton?.setAttribute("aria-expanded", "false");
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
      return;
    }

    const firstInput = fieldInputs.get(options.fields[0]?.id ?? "");
    validationError.textContent = options.validationMessage;
    validationError.hidden = false;
    firstInput?.setAttribute("aria-invalid", "true");
    firstInput?.setAttribute("aria-describedby", validationErrorId);
    firstInput?.focus();
  });
  cancelButton.addEventListener("click", () => close(true));
  panel.addEventListener("keydown", (event) => {
    if (event.isComposing) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Enter") {
      if (event.target instanceof HTMLButtonElement) {
        return;
      }
      event.preventDefault();
      saveButton.click();
    }
  });
  const handleDocumentMouseDown = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Node) || panel.hidden) {
      return;
    }
    if (panel.contains(target) || activeButton?.contains(target)) {
      return;
    }
    close(false);
  };

  document.addEventListener("mousedown", handleDocumentMouseDown, true);
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);
  window.visualViewport?.addEventListener("resize", reposition);
  window.visualViewport?.addEventListener("scroll", reposition);

  return {
    panel,
    open(button, defaults = {}) {
      activeButton = button;
      button.setAttribute("aria-expanded", "true");
      clearValidation();
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
    destroy() {
      close(false);
      document.removeEventListener("mousedown", handleDocumentMouseDown, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
      panel.remove();
    },
  };
}

export function EditorPlayground() {
  const editorRef = useRef<MarkdownEditor | null>(null);
  const editorElementRef = useRef<HTMLDivElement | null>(null);
  const toolbarElementRef = useRef<HTMLDivElement | null>(null);
  const sourceTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [mathEdit, setMathEdit] = useState<MathEdit | null>(null);
  const mathDialogOpenRef = useRef(false);
  const [output, setOutput] = useState(() => playgroundRouteSession.editorMarkdown);
  const [sourceActionState, setSourceActionState] = useState<"applied" | "dirty" | "idle">(
    () => playgroundRouteSession.sourceDirty ? "dirty" : "idle",
  );

  useEffect(() => {
    const editorElement = editorElementRef.current;
    const toolbarElement = toolbarElementRef.current;
    const sourceTextarea = sourceTextareaRef.current;

    if (!editorElement || !toolbarElement || !sourceTextarea) {
      return;
    }

    const mountedSession = playgroundRouteSession;
    let sourceDraftDirty = mountedSession.sourceDirty;
    let applyingSource = false;
    const applyButton = document.getElementById("apply-markdown-button");

    const tooltipController = createToolbarTooltip();
    toolbarElement.setAttribute("role", "toolbar");
    toolbarElement.setAttribute("aria-label", "Formatting");
    const preserveEditorSelection = (event: Event) => event.preventDefault();
    toolbarElement.addEventListener("pointerdown", preserveEditorSelection);
    toolbarElement.addEventListener("mousedown", preserveEditorSelection);

    const linkPopover = createToolbarPopover(editorRef, {
      title: "Add link",
      fields: [{ id: "href", label: "URL", placeholder: "https://example.com" }],
      validationMessage: "Enter a valid link URL.",
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
      validationMessage: "Enter a valid image URL.",
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

    const math = createMathExtension({
      renderer: renderMath,
      onEditSource(request) {
        closeAllPopovers(false);
        mathDialogOpenRef.current = true;
        setMathEdit({ mode: "edit", kind: request.kind, source: request.source,
          apply: request.update, remove: request.remove });
      },
    });
    const openMath = () => {
      const current = editorRef.current;
      if (!current || current.view.composing || mathDialogOpenRef.current) return;
      closeAllPopovers(false);
      const { doc, selection } = current.view.state;
      const handle = current.extensions.get(math);
      const selected = handle.state.getNodes().find(node => node.position === selection.from
        && doc.nodeAt(node.position)?.nodeSize === selection.to - selection.from);
      mathDialogOpenRef.current = true;
      if (selected) {
        setMathEdit({ mode: "edit", kind: selected.kind, source: selected.source,
          apply: source => handle.commands.update(selected, source), remove: () => handle.commands.remove(selected) });
      } else {
        setMathEdit({ mode: "insert", kind: "block", source: doc.textBetween(selection.from, selection.to, " "),
          apply(source: string, kind: MathKind) {
            // A source reconciliation or route replacement must never insert at a stale position.
            if (current.isDestroyed || current.view.state.doc !== doc) return false;
            current.view.dispatch(current.view.state.tr.setSelection(selection));
            return kind === "inline" ? handle.commands.insertInline(source) : handle.commands.insertBlock(source);
          } });
      }
    };
    const mathButton = createToolbarButton(tooltipController, createToolbarIcon(Sigma),
      { label: "Insert math", shortcut: "Mod+Shift+M" }, openMath, { compact: true });
    mathButton.setAttribute("aria-haspopup", "dialog");
    const mathShortcut = (event: KeyboardEvent) => {
      if ((isApplePlatform ? event.metaKey : event.ctrlKey) && event.shiftKey && !event.altKey
        && event.key.toLowerCase() === "m" && !event.isComposing) {
        event.preventDefault();
        openMath();
      }
    };
    // The source textarea remains a literal Markdown editor; this shortcut belongs to rich editing.
    editorElement.addEventListener("keydown", mathShortcut);
    toolbarElement.addEventListener("keydown", mathShortcut);

    const undoButton = createToolbarButton(
      tooltipController,
      createToolbarIcon(Undo2),
      { label: "Undo", shortcut: "Mod+Z" },
      () => editorRef.current?.commands.undo(),
      { compact: true },
    );
    const redoButton = createToolbarButton(
      tooltipController,
      createToolbarIcon(Redo2),
      { label: "Redo", shortcut: "Shift+Mod+Z" },
      () => editorRef.current?.commands.redo(),
      { compact: true },
    );
    const boldButton = createToolbarButton(
      tooltipController,
      createToolbarIcon(Bold),
      { label: "Bold", shortcut: "Mod+B" },
      () => editorRef.current?.commands.toggleMark("strong"),
      { compact: true },
    );
    const italicButton = createToolbarButton(
      tooltipController,
      createToolbarIcon(Italic),
      { label: "Italic", shortcut: "Mod+I" },
      () => editorRef.current?.commands.toggleMark("em"),
      { compact: true },
    );
    const codeButton = createToolbarButton(
      tooltipController,
      createToolbarIcon(Code2),
      { label: "Inline code", shortcut: "Mod+E" },
      () => editorRef.current?.commands.toggleMark("code"),
      { compact: true },
    );
    const strikeButton = createToolbarButton(
      tooltipController,
      createToolbarIcon(Strikethrough),
      { label: "Strike", shortcut: "Mod+Shift+X" },
      () => editorRef.current?.commands.toggleMark("strike"),
      { compact: true },
    );

    const linkButton = createToolbarButton(
      tooltipController,
      createToolbarIcon(Link2),
      { label: "Add or edit link" },
      () => {
        const editor = editorRef.current;
        if (editor?.state.isActive.mark("link")) {
          closeAllPopovers(false);
          editor.ui?.editLink();
          return;
        }
        imagePopover.close(false);
        linkPopover.open(linkButton);
      },
      { compact: true },
    );
    const unlinkButton = createToolbarButton(
      tooltipController,
      createToolbarIcon(Link2Off),
      { label: "Remove link" },
      () => editorRef.current?.commands.removeLink(),
      { compact: true },
    );
    unlinkButton.classList.add("mdw-toolbar-button-secondary");

    const imageButton = createToolbarButton(
      tooltipController,
      createToolbarIcon(ImagePlus),
      { label: "Insert or edit image" },
      () => {
        const editor = editorRef.current;
        if (editor?.state.isActive.node("image")) {
          closeAllPopovers(false);
          editor.ui?.editImage();
          return;
        }
        linkPopover.close(false);
        imagePopover.open(imageButton);
      },
      { compact: true },
    );
    for (const [button, popover] of [
      [linkButton, linkPopover],
      [imageButton, imagePopover],
    ] as const) {
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-controls", popover.panel.id);
      button.setAttribute("aria-expanded", "false");
    }
    const removeImageButton = createToolbarButton(
      tooltipController,
      createToolbarIcon(ImageOff),
      { label: "Remove image" },
      () => editorRef.current?.commands.removeImage(),
      { compact: true },
    );
    removeImageButton.classList.add("mdw-toolbar-button-secondary");

    toolbarElement.append(
      createToolbarGroup("History", undoButton, redoButton),
      createToolbarGroup("Formatting", boldButton, italicButton, codeButton, strikeButton),
      createToolbarGroup("Links", linkButton, unlinkButton),
      createToolbarGroup("Images", imageButton, removeImageButton),
      createToolbarGroup("Math", mathButton),
    );
    const toolbarKeyboardNavigation = createToolbarKeyboardNavigation(toolbarElement);

    const setButtonState = (button: HTMLButtonElement, state: { enabled: boolean; active?: boolean }) => {
      button.disabled = !state.enabled;
      button.classList.toggle("is-active", state.active === true);
      if (state.active === undefined) {
        button.removeAttribute("aria-pressed");
      } else {
        button.setAttribute("aria-pressed", String(state.active));
      }
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
      unlinkButton.disabled = !editor.state.can.removeLink();
      removeImageButton.disabled = !editor.state.can.removeImage();
      toolbarKeyboardNavigation.refresh();
      if (!linkState.enabled && linkPopover.isOpen()) {
        linkPopover.close(false);
      }
      if (!imageState.enabled && imagePopover.isOpen()) {
        imagePopover.close(false);
      }
    };

    const editor = createEditor({
      element: editorElement,
      markdown: mountedSession.editorMarkdown,
      ariaLabel: "Markdown document editor",
      ui: createDefaultUi({ contextMenu: { providers: [createMathContextMenuProvider(math, openMath)] } }),
      extensions: [math],
      onChange(markdown) {
        const sourceMarkdown = sourceTextareaRef.current?.value
          ?? playgroundRouteSession.sourceMarkdown;
        const preserveSourceDraft = !applyingSource
          && sourceDraftDirty
          && sourceMarkdown !== markdown;
        sourceDraftDirty = preserveSourceDraft;
        rememberPlaygroundRouteSession({
          editorMarkdown: markdown,
          sourceMarkdown: preserveSourceDraft ? sourceMarkdown : markdown,
          sourceDirty: preserveSourceDraft,
        });
        setOutput(markdown);
        if (sourceTextareaRef.current && !preserveSourceDraft) {
          sourceTextareaRef.current.value = markdown;
        }
        setSourceActionState(applyingSource ? "applied" : preserveSourceDraft ? "dirty" : "idle");
      },
    });

    const exposeNestedCodeEditorsToTabOrder = () => {
      for (const content of editorElement.querySelectorAll<HTMLElement>(".cm-content[contenteditable]")) {
        if (!content.hasAttribute("tabindex")) {
          content.tabIndex = 0;
          content.dataset.demoCodeTabstop = "true";
        }
      }
    };
    const codeEditorObserver = new MutationObserver(exposeNestedCodeEditorsToTabOrder);
    codeEditorObserver.observe(editorElement, { childList: true, subtree: true });
    exposeNestedCodeEditorsToTabOrder();

    editorRef.current = editor;
    const stopState = editor.subscribe("state", () => {
      closeAllPopovers(false);
      renderToolbar();
    });
    sourceTextarea.value = mountedSession.sourceMarkdown;
    rememberPlaygroundRouteSession({
      editorMarkdown: editor.getMarkdown(),
      sourceMarkdown: mountedSession.sourceMarkdown,
      sourceDirty: sourceDraftDirty,
    });
    setOutput(editor.getMarkdown());
    renderToolbar();
    setSourceActionState(sourceDraftDirty ? "dirty" : "idle");

    const rememberSourceDraft = () => {
      const editorMarkdown = editorRef.current?.getMarkdown()
        ?? playgroundRouteSession.editorMarkdown;
      sourceDraftDirty = sourceTextarea.value !== editorMarkdown;
      rememberPlaygroundRouteSession({
        editorMarkdown,
        sourceMarkdown: sourceTextarea.value,
        sourceDirty: sourceDraftDirty,
      });
      setSourceActionState(sourceDraftDirty ? "dirty" : "idle");
    };

    const applyMarkdown = () => {
      if (!sourceDraftDirty || !editorRef.current || !sourceTextareaRef.current) {
        return;
      }
      applyingSource = true;
      try {
        editorRef.current.commands.reconcileMarkdown(sourceTextareaRef.current.value, { emitChange: true });
        editorRef.current.flushChange();
      } finally {
        applyingSource = false;
      }
      const markdown = editorRef.current.getMarkdown();
      sourceDraftDirty = false;
      sourceTextareaRef.current.value = markdown;
      rememberPlaygroundRouteSession({
        editorMarkdown: markdown,
        sourceMarkdown: markdown,
        sourceDirty: false,
      });
      setOutput(markdown);
      setSourceActionState("applied");
    };

    const closeFromMouse = () => closeAllPopovers(false);
    const closeFromFocus = () => closeAllPopovers(false);

    editorElement.addEventListener("mousedown", closeFromMouse);
    sourceTextarea.addEventListener("input", rememberSourceDraft);
    sourceTextarea.addEventListener("focus", closeFromFocus);

    applyButton?.addEventListener("focus", closeFromFocus);
    applyButton?.addEventListener("click", applyMarkdown);

    return () => {
      const editorMarkdown = editor.getMarkdown();
      const editorChangedSinceSession = editorMarkdown !== playgroundRouteSession.editorMarkdown;
      rememberPlaygroundRouteSession({
        editorMarkdown,
        sourceMarkdown: !sourceDraftDirty && editorChangedSinceSession
          ? editorMarkdown
          : sourceTextarea.value,
        sourceDirty: sourceDraftDirty,
      });
      applyButton?.removeEventListener("focus", closeFromFocus);
      applyButton?.removeEventListener("click", applyMarkdown);
      sourceTextarea.removeEventListener("focus", closeFromFocus);
      sourceTextarea.removeEventListener("input", rememberSourceDraft);
      editorElement.removeEventListener("mousedown", closeFromMouse);
      editorElement.removeEventListener("keydown", mathShortcut);
      toolbarElement.removeEventListener("keydown", mathShortcut);
      toolbarElement.removeEventListener("pointerdown", preserveEditorSelection);
      toolbarElement.removeEventListener("mousedown", preserveEditorSelection);
      toolbarKeyboardNavigation.destroy();
      codeEditorObserver.disconnect();
      stopState();
      editor.destroy();
      editorRef.current = null;
      toolbarElement.innerHTML = "";
      tooltipController.destroy();
      linkPopover.destroy();
      imagePopover.destroy();
    };
  }, []);

  return (
    <div className="playground-shell">
      {mathEdit && <MathDialog request={mathEdit} onClose={() => {
        mathDialogOpenRef.current = false;
        setMathEdit(null);
        requestAnimationFrame(() => editorRef.current?.focus());
      }} onSaved={() => editorRef.current?.flushChange()} />}
      <div className="playground-intro">
        <div>
          <span className="eyebrow">Core playground</span>
          <h1>Try the Markora editor.</h1>
          <p>
            Write naturally, format with the toolbar, or edit the Markdown source. Try a different
            {" "}theme using the menu above.
          </p>
        </div>
      </div>

      <div className="playground-layout">
        <section className="panel panel-editor">
          <div className="panel-header">
            <h2>Visual editor</h2>
            <p>Try headings, tasks, tables, code, and math. Use the Σ button to insert a formula or edit one below.</p>
          </div>
          <div ref={toolbarElementRef} className="mdw-toolbar" />
          <div ref={editorElementRef} id="editor" />
        </section>

        <section className="panel panel-source">
          <div className="panel-header">
            <h2 id="playground-source-heading">Markdown source</h2>
            <p>
              Edit the source, then choose Apply Markdown to update the editor.
            </p>
          </div>
          <textarea
            ref={sourceTextareaRef}
            id="source"
            aria-labelledby="playground-source-heading"
            spellCheck={false}
            wrap="off"
            defaultValue={initialMarkdown}
          />
          <div className="source-actions">
            <button
              id="apply-markdown-button"
              type="button"
              className="button button-primary"
              aria-describedby="playground-source-status"
              aria-disabled={sourceActionState === "dirty" ? "false" : "true"}
            >
              Apply Markdown
            </button>
            <span
              id="playground-source-status"
              className="source-status"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {sourceActionState === "applied"
                ? "Markdown applied to the visual editor."
                : sourceActionState === "dirty"
                  ? "Source changes are ready to apply."
                  : "No source changes to apply."}
            </span>
          </div>
        </section>
      </div>

      <section className="panel panel-output">
        <div className="panel-header">
          <h2>Serialized output</h2>
          <p>The editor’s Markdown appears here after you pause typing. This playground includes the math extension: inline formulas use $…$, and display formulas use $$…$$.</p>
        </div>
        <pre id="output" role="region" tabIndex={0} aria-label="Serialized Markdown output">{output}</pre>
      </section>
    </div>
  );
}
