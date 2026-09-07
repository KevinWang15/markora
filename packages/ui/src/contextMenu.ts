import type { MarkdownEditor } from "markora";
import { createBrowserClipboard } from "./contextMenuClipboard";
import { createDefaultMenuProviders } from "./contextMenuDefaults";
import { composeMenuItems, reportMenuError, type NormalizedContextMenuConfig } from "./contextMenuModel";
import { ownsMenuEvent, targetPointerSelection } from "./contextMenuTarget";
import type { ContextMenuAction, ContextMenuContext, ContextMenuItem, ContextMenuSubmenu } from "./contextMenuTypes";
import { measurePositionSpace, setViewportPosition } from "./positioning";

type Panel = { dom: HTMLDivElement; buttons: HTMLButtonElement[]; items: Exclude<ContextMenuItem, { type: "separator" }>[]; trigger?: HTMLButtonElement; scaleY: number };
type Session = { context: ContextMenuContext; abort: AbortController; panels: Panel[]; x: number; y: number; executing: boolean; scrollOffsets: Map<EventTarget, readonly [number, number]> };
let nextMenuId = 0;

export function createContextMenu(options: Readonly<{
  editor: MarkdownEditor;
  config: NormalizedContextMenuConfig;
  portalRoot: HTMLElement | ShadowRoot;
  syncEnvironment: (target: HTMLElement, view: MarkdownEditor["view"], onInvalidated?: () => void) => void;
  beforeOpen: () => void;
  releaseEnvironment: (target: HTMLElement) => void;
}>) {
  const { editor, config, portalRoot, syncEnvironment } = options;
  const doc = editor.view.dom.ownerDocument;
  const win = doc.defaultView as Window & typeof globalThis;
  const clipboard = config.clipboard ?? createBrowserClipboard(win);
  let session: Session | null = null;
  let destroyed = false;
  let hoverTimer: number | undefined;
  let search = "";
  let searchTime = 0;

  function activeElement(): Element | null {
    let active = doc.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
  }
  function containsEvent(event: Event) {
    return !!session?.panels.some(panel => event.composedPath().includes(panel.dom));
  }
  function clearHover() { win.clearTimeout(hoverTimer); hoverTimer = undefined; }
  function close(refocus = false) {
    const current = session;
    if (!current) return;
    const active = activeElement();
    const ownsFocus = current.panels.some(panel => active && panel.dom.contains(active));
    session = null;
    clearHover(); search = "";
    current.abort.abort();
    for (const panel of current.panels) { options.releaseEnvironment(panel.dom); panel.dom.remove(); }
    if (refocus && ownsFocus && !editor.isDestroyed) editor.focus();
  }
  function truncatePanels(depth: number) {
    if (!session) return;
    session.panels[depth - 1]?.dom.removeAttribute("aria-owns");
    for (const panel of session.panels.splice(depth)) {
      panel.trigger?.setAttribute("aria-expanded", "false");
      panel.trigger?.removeAttribute("aria-controls");
      options.releaseEnvironment(panel.dom);
      panel.dom.remove();
    }
  }
  function positionPanels() {
    const current = session;
    if (!current) return;
    if (!current.context.isCurrent()) { close(false); return; }
    const viewport = win.visualViewport;
    const left = (viewport?.offsetLeft ?? 0) + 8, top = (viewport?.offsetTop ?? 0) + 8;
    const right = left + (viewport?.width || win.innerWidth) - 16;
    const bottom = top + (viewport?.height || win.innerHeight) - 16;
    for (const panel of current.panels) {
      const space = measurePositionSpace(panel.dom);
      panel.scaleY = space.scaleY;
      const availableWidth = Math.max(48, (right - left) / space.scaleX);
      panel.dom.style.minWidth = `min(var(--mdw-ui-menu-inline-size, 224px), ${availableWidth}px)`;
      panel.dom.style.maxHeight = `${Math.max(48, (bottom - top) / space.scaleY)}px`;
      panel.dom.style.maxWidth = `${availableWidth}px`;
      const rect = panel.dom.getBoundingClientRect();
      const anchor = panel.trigger?.getBoundingClientRect();
      const rtl = panel.dom.dir === "rtl";
      let x = anchor ? (rtl ? anchor.left - rect.width : anchor.right) : current.x;
      let y = anchor?.top ?? current.y;
      if (anchor && (x < left || x + rect.width > right)) x = rtl ? anchor.right : anchor.left - rect.width;
      x = Math.max(left, Math.min(x, right - rect.width));
      y = Math.max(top, Math.min(y, bottom - rect.height));
      setViewportPosition(panel.dom, x, y, space);
    }
  }
  function enabled(item: Panel["items"][number]): boolean {
    return item.type === "action" ? item.enabled !== false : item.items.some(child => child.type !== "separator" && enabled(child));
  }
  function focusButton(panel: Panel, button: HTMLButtonElement) {
    for (const peer of panel.buttons) peer.tabIndex = peer === button ? 0 : -1;
    button.focus({ preventScroll: true });
    // Scroll only the menu, never an editor/page ancestor (which dismisses it).
    const itemRect = button.getBoundingClientRect();
    const panelRect = panel.dom.getBoundingClientRect();
    const scaleY = panel.scaleY;
    if (itemRect.top < panelRect.top) panel.dom.scrollTop -= (panelRect.top - itemRect.top) / scaleY;
    else if (itemRect.bottom > panelRect.bottom) panel.dom.scrollTop += (itemRect.bottom - panelRect.bottom) / scaleY;
  }
  function focusFirst(panel: Panel) {
    const first = panel.buttons[0];
    if (first) focusButton(panel, first); else panel.dom.focus({ preventScroll: true });
  }
  function openSubmenu(item: ContextMenuSubmenu, trigger: HTMLButtonElement, depth: number, focus: boolean) {
    if (!session || session.executing) return;
    clearHover();
    if (session.panels[depth + 1]?.trigger === trigger) {
      if (focus) focusFirst(session.panels[depth + 1]);
      return;
    }
    truncatePanels(depth + 1);
    const panel = createPanel(item.items, item.label, depth + 1, trigger);
    session!.panels[depth].dom.setAttribute("aria-owns", panel.dom.id);
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("aria-controls", panel.dom.id);
    positionPanels();
    if (focus) focusFirst(panel);
  }
  function announce(current: Session, message: string, error = false) {
    const root = current.panels[0].dom;
    root.querySelector(".mdw-context-menu-status")?.remove();
    const status = doc.createElement("div");
    status.className = "mdw-context-menu-status";
    status.setAttribute("role", error ? "alert" : "status");
    status.textContent = message;
    root.append(status);
    positionPanels();
  }
  async function execute(item: ContextMenuAction) {
    const current = session;
    if (!current || current.executing || item.enabled === false) return;
    if (!current.context.isCurrent()) { close(false); return; }
    current.executing = true;
    clearHover();
    try {
      const result = item.run(current.context);
      if (result && typeof (result as Promise<unknown>).then === "function" && session === current) {
        current.panels[0].dom.setAttribute("aria-busy", "true");
        announce(current, config.messages.pendingLabel);
      }
      const success = await result;
      if (session !== current) return;
      if (success === false) throw new Error(`Menu action rejected: ${item.id}.`);
      close(true);
    } catch (error) {
      if (session === current && current.context.isCurrent()) {
        reportMenuError(config, error, current.context);
        announce(current, item.id.startsWith("clipboard.") ? config.messages.clipboardErrorLabel : config.messages.errorLabel, true);
      }
    } finally {
      current.executing = false;
      if (session === current) current.panels[0].dom.removeAttribute("aria-busy");
    }
  }
  function createPanel(items: readonly ContextMenuItem[], label: string, depth: number, trigger?: HTMLButtonElement): Panel {
    const dom = doc.createElement("div");
    dom.className = "mdw-context-menu";
    dom.id = `mdw-context-menu-${++nextMenuId}`;
    dom.setAttribute("role", "menu"); dom.setAttribute("aria-label", label);
    dom.tabIndex = -1;
    const panel: Panel = { dom, buttons: [], items: [], trigger, scaleY: 1 };
    session!.panels.push(panel);
    for (const item of items) {
      if (item.type === "separator") {
        const separator = doc.createElement("div"); separator.setAttribute("role", "separator"); dom.append(separator); continue;
      }
      const button = doc.createElement("button"); button.type = "button";
      button.className = "mdw-context-menu-item";
      button.dataset.mdwMenuItem = item.id;
      button.tabIndex = -1;
      button.setAttribute("role", item.type === "action" && item.checked !== undefined ? "menuitemcheckbox" : "menuitem");
      button.setAttribute("aria-label", item.label);
      button.setAttribute("aria-disabled", String(!enabled(item)));
      const check = doc.createElement("span"); check.className = "mdw-context-menu-check"; check.setAttribute("aria-hidden", "true");
      if (item.type === "action" && item.checked !== undefined) { button.setAttribute("aria-checked", String(item.checked)); check.textContent = item.checked ? "✓" : ""; }
      if (item.type === "action" && item.danger) button.classList.add("mdw-context-menu-danger");
      const text = doc.createElement("span"); text.className = "mdw-context-menu-label"; text.textContent = item.label;
      const hint = doc.createElement("span"); hint.className = "mdw-context-menu-hint"; hint.setAttribute("aria-hidden", "true");
      if (item.type === "submenu") {
        button.setAttribute("aria-haspopup", "menu"); button.setAttribute("aria-expanded", "false");
        hint.classList.add("mdw-context-menu-chevron"); hint.textContent = "›";
      } else hint.textContent = item.shortcut ?? "";
      button.append(check, text, hint); dom.append(button); panel.buttons.push(button); panel.items.push(item);
      button.addEventListener("pointerenter", event => {
        clearHover();
        if (session?.executing || !enabled(item) || event.pointerType === "touch") return;
        focusButton(panel, button);
        hoverTimer = win.setTimeout(() => {
          if (item.type === "submenu") openSubmenu(item, button, depth, false);
          else truncatePanels(depth + 1);
        }, 160);
      });
      button.addEventListener("pointerleave", clearHover);
      button.addEventListener("click", () => {
        if (!enabled(item)) return;
        if (item.type === "submenu") openSubmenu(item, button, depth, true); else void execute(item);
      });
    }
    dom.addEventListener("pointerdown", event => event.preventDefault());
    dom.addEventListener("contextmenu", event => event.preventDefault());
    dom.addEventListener("keydown", event => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Tab") { close(true); return; }
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault(); clearHover();
        if (depth && !session?.executing) { truncatePanels(depth); panel.trigger?.focus(); } else close(true);
        return;
      }
      if (session?.executing) { event.preventDefault(); return; }
      const active = activeElement();
      const index = panel.buttons.findIndex(button => button === active);
      const available = panel.buttons;
      const position = available.indexOf(active as HTMLButtonElement);
      const forward = dom.dir === "rtl" ? "ArrowLeft" : "ArrowRight";
      const backward = dom.dir === "rtl" ? "ArrowRight" : "ArrowLeft";
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); clearHover();
        const next = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1
          : (position + (event.key === "ArrowDown" ? 1 : -1) + available.length) % available.length;
        if (available[next]) { truncatePanels(depth + 1); focusButton(panel, available[next]); }
      } else if (event.key === forward && panel.items[index]?.type === "submenu" && enabled(panel.items[index])) {
        event.preventDefault(); openSubmenu(panel.items[index] as ContextMenuSubmenu, panel.buttons[index], depth, true);
      } else if (event.key === backward && depth) {
        event.preventDefault(); truncatePanels(depth); panel.trigger?.focus();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault(); const item = panel.items[index];
        if (item && enabled(item)) { if (item.type === "submenu") openSubmenu(item, panel.buttons[index], depth, true); else void execute(item); }
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault(); clearHover();
        const now = Date.now(); search = now - searchTime > 600 ? event.key : search + event.key; searchTime = now;
        const term = [...search].every(char => char === search[0]) ? search[0] : search;
        const match = [...available.slice(position + 1), ...available.slice(0, position + 1)]
          .find(button => button.getAttribute("aria-label")!.toLocaleLowerCase().startsWith(term.toLocaleLowerCase()));
        if (match) { truncatePanels(depth + 1); focusButton(panel, match); }
      }
    });
    portalRoot.append(dom);
    syncEnvironment(dom, editor.view, positionPanels);
    return panel;
  }
  function scrollOffset(target: EventTarget): readonly [number, number] {
    return target === doc ? [win.scrollX, win.scrollY]
      : [(target as Element).scrollLeft, (target as Element).scrollTop];
  }
  function captureScrollOffsets() {
    const offsets = new Map<EventTarget, readonly [number, number]>([[doc, scrollOffset(doc)]]);
    for (const start of [editor.view.dom, portalRoot instanceof win.ShadowRoot ? portalRoot.host : portalRoot]) {
      let element: Element | null = start;
      while (element) {
        offsets.set(element, scrollOffset(element));
        const root = element.getRootNode();
        element = element.parentElement ?? (root instanceof win.ShadowRoot ? root.host : null);
      }
    }
    return offsets;
  }
  function open(source: ContextMenuContext["source"], x: number, y: number) {
    close(false);
    if (destroyed || editor.isDestroyed || editor.view.composing) return false;
    options.beforeOpen();
    const { doc: documentNode, selection } = editor.view.state;
    const editable = editor.view.editable;
    const abort = new win.AbortController();
    const context: ContextMenuContext = Object.freeze({ editor, selection, source, signal: abort.signal,
      isCurrent: () => !abort.signal.aborted && !editor.isDestroyed && editor.view.editable === editable
        && editor.view.state.doc === documentNode && editor.view.state.selection.eq(selection) });
    try {
      const items = composeMenuItems(config, context, config.includeDefaults === false ? [] : createDefaultMenuProviders(context, clipboard));
      if (!items.length || !context.isCurrent()) { abort.abort(); return false; }
      session = { context, abort, panels: [], x, y, executing: false, scrollOffsets: captureScrollOffsets() };
      const root = createPanel(items, config.messages.menuLabel, 0);
      positionPanels(); focusFirst(root);
      return true;
    } catch (error) { abort.abort(); close(false); reportMenuError(config, error, context); return false; }
  }
  function onContextMenu(event: MouseEvent) {
    if (!ownsMenuEvent(editor, event) || editor.view.composing) return;
    const keyboard = event.clientX === 0 && event.clientY === 0;
    if (!keyboard && !targetPointerSelection(editor, event.clientX, event.clientY)) return;
    const anchor = keyboard ? editor.view.coordsAtPos(editor.view.state.selection.from) : null;
    if (open(keyboard ? "keyboard" : "pointer", anchor?.left ?? event.clientX, anchor?.bottom ?? event.clientY)) event.preventDefault();
  }
  function onKeyDown(event: KeyboardEvent) {
    if (!ownsMenuEvent(editor, event) || event.isComposing || editor.view.composing) return;
    if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey)) return;
    const anchor = editor.view.coordsAtPos(editor.view.state.selection.from);
    if (open("keyboard", anchor.left, anchor.bottom)) { event.preventDefault(); event.stopPropagation(); }
  }
  function preserveSelection(event: MouseEvent) {
    if ((event.button === 2 || (event.button === 0 && event.ctrlKey && /Mac/u.test(win.navigator.platform))) && ownsMenuEvent(editor, event) && !editor.view.composing) event.preventDefault();
  }
  const dismissOutside = (event: Event) => { if (session && !containsEvent(event)) close(false); };
  const dismissScroll = (event: Event) => {
    if (!session || !event.target || containsEvent(event)) return;
    const previous = session.scrollOffsets.get(event.target);
    if (!previous) return;
    const current = scrollOffset(event.target);
    // Browsers may deliver an earlier scroll event after the menu has opened.
    if (current[0] !== previous[0] || current[1] !== previous[1]) close(false);
  };
  const dismissWindow = () => close(false);
  let untrack = () => {};
  let observer: MutationObserver | undefined;
  const controller = { destroy() {
    if (destroyed) return;
    destroyed = true; close(false); untrack(); observer?.disconnect();
    editor.view.dom.removeEventListener("contextmenu", onContextMenu);
    editor.view.dom.removeEventListener("keydown", onKeyDown, true);
    editor.view.dom.removeEventListener("pointerdown", preserveSelection, true);
    editor.view.dom.removeEventListener("mousedown", preserveSelection, true);
    doc.removeEventListener("pointerdown", dismissOutside, true);
    doc.removeEventListener("focusin", dismissOutside, true);
    doc.removeEventListener("scroll", dismissScroll, true);
    win.removeEventListener("blur", dismissWindow); win.removeEventListener("resize", dismissWindow);
    win.visualViewport?.removeEventListener("resize", dismissWindow); win.visualViewport?.removeEventListener("scroll", dismissWindow);
  } };
  try {
    untrack = editor.subscribe("state", () => { if (session && !session.context.isCurrent()) close(session.executing); });
    observer = new win.MutationObserver(() => { if (session && !session.context.isCurrent()) close(false); });
    observer.observe(editor.view.dom, { attributes: true, attributeFilter: ["contenteditable"] });
    editor.view.dom.addEventListener("contextmenu", onContextMenu);
    editor.view.dom.addEventListener("keydown", onKeyDown, true);
    editor.view.dom.addEventListener("pointerdown", preserveSelection, true);
    editor.view.dom.addEventListener("mousedown", preserveSelection, true);
    doc.addEventListener("pointerdown", dismissOutside, true);
    doc.addEventListener("focusin", dismissOutside, true);
    doc.addEventListener("scroll", dismissScroll, true);
    win.addEventListener("blur", dismissWindow);
    win.addEventListener("resize", dismissWindow);
    win.visualViewport?.addEventListener("resize", dismissWindow);
    win.visualViewport?.addEventListener("scroll", dismissWindow);
  } catch (error) {
    controller.destroy();
    throw error;
  }
  return controller;
}
