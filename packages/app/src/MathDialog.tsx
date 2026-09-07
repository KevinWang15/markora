import Sigma from "@lucide/icons/icons/sigma";
import { useEffect, useId, useRef, useState } from "react";
import { MATH_MAX_SOURCE_BYTES, type MathKind } from "markora-extension-math";
import { Dialog } from "./Dialog";
import { renderMath } from "./renderers";

export type MathEdit = Readonly<{
  mode: "insert" | "edit";
  source: string;
  kind: MathKind;
  apply: (source: string, kind: MathKind) => boolean;
  remove?: () => boolean;
}>;

const templates = [
  { label: "Fraction", source: String.raw`\frac{a}{b}` },
  { label: "Square root", source: String.raw`\sqrt{x}` },
  { label: "Integral", source: String.raw`\int_0^1 x\,dx` },
  { label: "Matrix", source: String.raw`\begin{bmatrix} a & b \\ c & d \end{bmatrix}` },
] as const;

type Preview = { source: string; kind: MathKind; status: "empty" | "pending" | "ready" | "error"; error?: string };

export function MathDialog({ request, onClose, onSaved }: Readonly<{
  request: MathEdit;
  onClose: () => void;
  onSaved: () => void;
}>) {
  const [source, setSource] = useState(request.source);
  const [kind, setKind] = useState(request.kind);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<Preview>({ source, kind, status: "pending" });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const ready = preview.source === source && preview.kind === kind && preview.status === "ready";
  const pending = source.trim() !== "" && (preview.source !== source || preview.kind !== kind || preview.status === "pending");

  useEffect(() => {
    const controller = new AbortController();
    const host = previewRef.current!;
    host.replaceChildren();
    setPreview({ source, kind, status: source.trim() ? "pending" : "empty" });
    const timer = window.setTimeout(async () => {
      if (!source.trim()) return;
      try {
        if (new TextEncoder().encode(source).length > MATH_MAX_SOURCE_BYTES) throw new Error("This formula is too large to preview. Shorten its LaTeX source.");
        if (kind === "inline" && (/[\r\n]/u.test(source) || source.trim() !== source)) {
          throw new Error("Inline math needs one line without leading or trailing spaces. Choose Display for multiple lines.");
        }
        const result = await renderMath({ source, kind, ownerDocument: host.ownerDocument, signal: controller.signal });
        if (controller.signal.aborted) return;
        host.replaceChildren(result);
        setPreview({ source, kind, status: "ready" });
      } catch (cause) {
        if (!controller.signal.aborted) setPreview({ source, kind, status: "error", error: cause instanceof Error ? cause.message : "This formula could not be previewed." });
      }
    }, 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [source, kind]);

  const changeSource = (value: string) => { setSource(value); setError(undefined); };
  const save = () => {
    if (!ready) return;
    if (request.mode === "edit" && source === request.source) { onClose(); return; }
    if (!request.apply(source, kind)) {
      setError(request.mode === "edit"
        ? "This formula has changed. Close this dialog and reopen the formula before saving."
        : "The formula cannot be inserted here. Inline math needs space or punctuation on each side. Try Display math, or choose another position in the document.");
      return;
    }
    onSaved(); onClose();
  };

  return <Dialog title={request.mode === "insert" ? "Insert math" : "Edit math"}
    message="Enter LaTeX without dollar-sign delimiters. Preview your formula before adding it to the document."
    variant="editor" icon={Sigma} error={error} onCancel={onClose} initialFocus={inputRef}
    content={<div className="app-math-editor">
      {request.mode === "insert" ? <fieldset className="app-math-placement">
        <legend>Placement</legend>
        <label><input type="radio" name={`${id}-kind`} checked={kind === "inline"} onChange={() => { setKind("inline"); setError(undefined); }} /> Inline <span>Within a sentence</span></label>
        <label><input type="radio" name={`${id}-kind`} checked={kind === "block"} onChange={() => { setKind("block"); setError(undefined); }} /> Display <span>On its own line</span></label>
      </fieldset> : <p className="app-math-kind">{kind === "inline" ? "Inline formula" : "Display formula"}</p>}
      <label htmlFor={`${id}-source`}>LaTeX source</label>
      <textarea ref={inputRef} id={`${id}-source`} autoFocus className="app-syntax-source" spellCheck={false}
        aria-describedby={`${id}-hint`} aria-invalid={preview.source === source && preview.kind === kind && preview.status === "error"}
        value={source} onChange={event => changeSource(event.target.value)}
        onKeyDown={event => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault(); event.stopPropagation(); save();
          }
        }} />
      <div className="app-math-templates" role="group" aria-label="Formula templates">
        {templates.map(template => <button className="app-dialog-button" type="button" key={template.label} onClick={() => {
          const input = inputRef.current!;
          const start = input.selectionStart, end = input.selectionEnd;
          changeSource(source.slice(0, start) + template.source + source.slice(end));
          requestAnimationFrame(() => { input.focus(); input.setSelectionRange(start, start + template.source.length); });
        }}>{template.label}</button>)}
      </div>
      <p id={`${id}-hint`} className="app-math-hint">Saved as {kind === "inline" ? "$…$" : "$$…$$"} in Markdown. Ctrl+Enter (⌘Enter on Mac) applies the formula; Escape cancels.</p>
      <section className="app-math-preview" aria-label="Formula preview" aria-busy={pending}>
        <h3>Preview</h3>
        <div ref={previewRef} className="app-math-preview-content" />
        {pending && <p role="status">Updating preview…</p>}
        {!source.trim() && <p>Enter a formula or choose a template.</p>}
        {preview.source === source && preview.kind === kind && preview.error && <p role="alert">{preview.error}</p>}
      </section>
    </div>}>
    {request.remove && <button type="button" className="app-dialog-button app-dialog-button-danger app-math-remove" onClick={() => {
      if (!request.remove!()) { setError("This formula has changed. Close this dialog and reopen it before removing it."); return; }
      onSaved(); onClose();
    }}>Remove formula</button>}
    <button type="button" className="app-dialog-button" onClick={onClose}>Cancel</button>
    <button type="button" className="app-dialog-button app-dialog-button-primary" disabled={!ready} onClick={save}>
      {request.mode === "insert" ? "Insert formula" : "Apply formula"}
    </button>
  </Dialog>;
}
