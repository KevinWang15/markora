import { closeHistory, type EditorView, type Node, type NodeView, type Transaction } from "markora/extension-api";
import type { ComponentMessages } from "./messages";
import { componentIdentityKey } from "./identity";
import { parseSource } from "./props";
import { readDefinition, serializeProps, validateProps } from "./registry";
import type { ComponentProps, ComponentRegistry } from "./types";

type Session = { controller: AbortController; cleanup?: () => void; identity?: object };

export class ComponentNodeView implements NodeView {
  readonly dom: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly title: HTMLElement;
  private readonly editButton: HTMLButtonElement;
  private readonly sourceButton: HTMLButtonElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLTextAreaElement;
  private readonly error: HTMLElement;
  private renderSession?: Session;
  private editSession?: Session;
  private destroyed = false;
  private editable = false;
  private renderRevision = 0;

  constructor(
    private node: Node,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly registry: ComponentRegistry,
    private readonly messages: ComponentMessages,
    private readonly dispatch: (transaction: Transaction) => boolean,
    private readonly reportError: (error: unknown, contribution?: string) => void,
    private readonly onDestroy: () => void,
  ) {
    const document = view.dom.ownerDocument;
    this.dom = document.createElement("section");
    this.dom.className = "mdw-component";
    this.dom.contentEditable = "false";
    const header = document.createElement("header");
    header.className = "mdw-component-header";
    this.title = document.createElement("strong");
    this.editButton = this.button(messages.edit, () => this.edit());
    this.sourceButton = this.button(messages.editSource, () => this.edit(true));
    header.append(this.title, this.editButton, this.sourceButton);
    this.preview = document.createElement("div");
    this.preview.className = "mdw-component-preview";
    this.form = document.createElement("form");
    this.form.className = "mdw-component-form";
    this.form.hidden = true;
    const label = document.createElement("label");
    label.textContent = messages.sourceLabel;
    this.input = document.createElement("textarea");
    this.input.rows = 9;
    this.input.spellcheck = false;
    label.append(this.input);
    this.error = document.createElement("div");
    this.error.className = "mdw-component-error";
    this.error.setAttribute("role", "alert");
    const apply = this.button(messages.apply, () => this.applySource());
    const cancel = this.button(messages.cancel, () => this.closeEditor(true));
    this.form.append(label, this.error, apply, cancel);
    this.form.addEventListener("submit", event => { event.preventDefault(); this.applySource(); });
    this.form.addEventListener("keydown", event => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeEditor(true);
      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.applySource();
      }
    });
    this.dom.append(header, this.preview, this.form);
  }

  private button(label: string, action: () => unknown) {
    const button = this.view.dom.ownerDocument.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }

  private dispose(session: Session | undefined) {
    if (!session) return;
    const cleanup = session.cleanup;
    session.cleanup = undefined;
    session.controller.abort();
    try { cleanup?.(); } catch (error) { this.reportError(error, "component-cleanup"); }
  }

  private acceptCleanup(session: Session, cleanup: unknown) {
    if (cleanup === undefined) return;
    if (typeof cleanup !== "function") {
      void Promise.resolve(cleanup).catch(error => this.reportError(error, "component-callback"));
      throw new TypeError("Component callbacks must return a cleanup function or undefined, not a Promise.");
    }
    session.cleanup = cleanup as () => void;
    if (session.controller.signal.aborted) this.dispose(session);
  }

  private fallback(message: string) {
    const document = this.dom.ownerDocument;
    const status = document.createElement("p");
    status.textContent = message;
    const source = document.createElement("pre");
    source.textContent = this.node.attrs.source;
    this.preview.replaceChildren(status, source);
  }

  refresh() {
    if (this.destroyed) return;
    const revision = ++this.renderRevision;
    const current = () => !this.destroyed && revision === this.renderRevision;
    this.closeEditor();
    if (!current()) return;
    const previous = this.renderSession;
    this.renderSession = undefined;
    this.preview.replaceChildren();
    this.dispose(previous);
    if (!current()) return;
    this.editable = this.view.editable;
    this.dom.dataset.component = this.node.attrs.name;
    const definition = this.registry.get(this.node.attrs.name);
    this.title.textContent = definition?.label ?? this.node.attrs.name;
    this.editButton.hidden = !this.editable;
    this.sourceButton.hidden = !this.editable || !definition || !readDefinition(definition).edit;
    if (!definition) {
      this.dom.dataset.status = "unregistered";
      this.fallback(this.messages.unavailable);
      return;
    }
    let props: ComponentProps;
    try {
      props = validateProps(definition, parseSource(this.node.attrs.source));
    } catch {
      if (!current()) return;
      this.dom.dataset.status = "invalid";
      this.fallback(this.messages.invalidProps);
      return;
    }
    if (!current()) return;
    const session: Session = { controller: new AbortController() };
    this.renderSession = session;
    const element = this.dom.ownerDocument.createElement("div");
    this.preview.append(element);
    try {
      this.acceptCleanup(session, readDefinition(definition).render({
        element, props, editable: this.editable, signal: session.controller.signal,
      }));
      if (current()) this.dom.dataset.status = "ready";
    } catch (error) {
      if (current()) {
        this.renderSession = undefined;
        this.dispose(session);
        if (current()) {
          this.dom.dataset.status = "error";
          this.fallback(this.messages.renderFailed);
        }
      }
      this.reportError(error, `render:${definition.name}`);
    }
  }

  syncEditable() {
    if (this.editable !== this.view.editable) this.refresh();
    else if (this.editSession && this.editSession.identity !== this.currentIdentity()) this.closeEditor();
  }

  private currentIdentity() {
    const position = this.position();
    return position === undefined ? undefined : componentIdentityKey.getState(this.view.state)?.get(position)?.identity;
  }

  position() {
    return this.destroyed ? undefined : this.getPos();
  }

  registeredName() { return this.node.attrs.name as string; }

  private replaceSource(expected: Node, session: Session, source: string): boolean {
    if (this.destroyed || session.controller.signal.aborted || !this.view.editable || this.view.composing
      || session.identity !== this.currentIdentity()) return false;
    const position = this.getPos();
    if (position === undefined || this.view.state.doc.nodeAt(position) !== expected) return false;
    if (expected.attrs.source === source) return true;
    this.dispatch(closeHistory(this.view.state.tr.setNodeMarkup(position, undefined, {
      ...expected.attrs, source,
    })));
    return this.view.state.doc.nodeAt(position)?.attrs.source === source;
  }

  edit(sourceOnly = false): boolean {
    if (this.destroyed || !this.view.editable || this.view.composing) return false;
    this.closeEditor();
    if (this.destroyed || this.editSession || !this.view.editable || this.view.composing) return false;
    const expected = this.node;
    const session: Session = { controller: new AbortController(), identity: this.currentIdentity() };
    this.editSession = session;
    const definition = this.registry.get(expected.attrs.name);
    const internal = definition && readDefinition(definition);
    if (!sourceOnly && definition && internal?.edit) {
      let props: ComponentProps | undefined;
      try { props = validateProps(definition, parseSource(expected.attrs.source)); } catch { props = undefined; }
      if (this.editSession !== session || session.controller.signal.aborted) return false;
      if (props) {
        try {
          this.acceptCleanup(session, internal.edit({
            anchor: this.dom,
            props,
            signal: session.controller.signal,
            cancel: () => { if (this.editSession === session) this.closeEditor(); },
            update: next => {
              if (session.controller.signal.aborted || this.registry.get(definition.name) !== definition) return false;
              const source = serializeProps(definition, next);
              const updated = this.replaceSource(expected, session, source);
              if (updated && this.editSession === session) this.closeEditor();
              return updated;
            },
          }));
          return true;
        } catch (error) {
          this.reportError(error, `edit:${definition.name}`);
          if (this.editSession === session) this.closeEditor();
          return false;
        }
      }
    }
    this.form.hidden = false;
    this.input.value = expected.attrs.source;
    this.input.removeAttribute("aria-invalid");
    this.error.textContent = "";
    this.input.focus();
    return true;
  }

  private applySource() {
    const session = this.editSession;
    const expected = this.node;
    if (!session || this.form.hidden) return;
    try {
      const source = this.input.value.replace(/\r\n?/g, "\n");
      const props = parseSource(source);
      const definition = this.registry.get(expected.attrs.name);
      if (definition) validateProps(definition, props);
      if (!this.replaceSource(expected, session, source)) throw new Error(this.messages.staleEdit);
      if (!this.editSession || this.editSession === session) this.closeEditor(true);
    } catch (error) {
      if (this.editSession !== session) return;
      this.input.setAttribute("aria-invalid", "true");
      this.error.textContent = error instanceof Error ? error.message : this.messages.invalidProps;
    }
  }

  private closeEditor(focus = false) {
    const session = this.editSession;
    this.editSession = undefined;
    this.form.hidden = true;
    this.dispose(session);
    if (focus && !this.destroyed) this.editButton.focus();
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false;
    if (node !== this.node) {
      this.node = node;
      this.refresh();
    }
    return true;
  }

  selectNode() { this.dom.classList.add("ProseMirror-selectednode"); }
  deselectNode() { this.dom.classList.remove("ProseMirror-selectednode"); }
  ignoreMutation() { return true; }
  stopEvent(event: Event) {
    const target = event.target as globalThis.Node | null;
    return Boolean(target && (this.preview.contains(target) || this.form.contains(target)
      || this.editButton.contains(target) || this.sourceButton.contains(target)));
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.closeEditor();
    const session = this.renderSession;
    this.renderSession = undefined;
    this.dispose(session);
    this.onDestroy();
  }
}
