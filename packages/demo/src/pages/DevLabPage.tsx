import { createEditor, type MarkdownEditor, type OpaqueMarkdownEditRequest } from "markora";
import { createDefaultUi } from "markora-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { devLabExamples } from "../lib/content";

type DevExample = (typeof devLabExamples)[number];

const DEFAULT_EXAMPLE = devLabExamples[0];

function getExampleFromHash(hash: string) {
  const slug = hash.replace(/^#/, "").trim();

  if (!slug) {
    return DEFAULT_EXAMPLE;
  }

  return devLabExamples.find((example) => example.slug === slug) ?? DEFAULT_EXAMPLE;
}

export function DevLabPage() {
  const editorElementRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MarkdownEditor | null>(null);
  const presetsButtonRef = useRef<HTMLButtonElement | null>(null);
  const presetsDialogRef = useRef<HTMLElement | null>(null);
  const sourceButtonRef = useRef<HTMLButtonElement | null>(null);
  const sourceDialogRef = useRef<HTMLElement | null>(null);
  const sourceTriggerRef = useRef<HTMLElement | null>(null);
  const opaqueEditRequestRef = useRef<OpaqueMarkdownEditRequest | null>(null);
  const activeExampleRef = useRef<DevExample>(getExampleFromHash(window.location.hash));
  const [activeSlug, setActiveSlug] = useState(activeExampleRef.current.slug);
  const [markdownSource, setMarkdownSource] = useState(activeExampleRef.current.markdown);
  const [sourceDraft, setSourceDraft] = useState(activeExampleRef.current.markdown);
  const [opaqueSourceDraft, setOpaqueSourceDraft] = useState("");
  const [opaqueSourceKind, setOpaqueSourceKind] = useState<OpaqueMarkdownEditRequest["kind"] | null>(null);
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const [isPresetsOpen, setIsPresetsOpen] = useState(false);

  const cancelSourceEdit = useCallback(() => {
    opaqueEditRequestRef.current = null;
    setOpaqueSourceDraft("");
    setOpaqueSourceKind(null);
    setIsSourceOpen(false);
  }, []);

  useEffect(() => {
    const editorElement = editorElementRef.current;

    if (!editorElement) {
      return;
    }

    const editor = createEditor({
      element: editorElement,
      markdown: activeExampleRef.current.markdown,
      ui: createDefaultUi(),
      onChange(markdown) {
        setMarkdownSource(markdown);
      },
      onEditOpaqueMarkdown(request) {
        sourceTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        opaqueEditRequestRef.current = request;
        setOpaqueSourceDraft(request.source);
        setOpaqueSourceKind(request.kind);
        setIsPresetsOpen(false);
        setIsSourceOpen(true);
      },
    });

    editorRef.current = editor;
    setMarkdownSource(editor.getMarkdown());

    const handleHashChange = () => {
      const nextExample = getExampleFromHash(window.location.hash);

      if (nextExample.slug === activeExampleRef.current.slug) {
        return;
      }

      activeExampleRef.current = nextExample;
      opaqueEditRequestRef.current = null;
      setOpaqueSourceKind(null);
      setActiveSlug(nextExample.slug);
      setSourceDraft(nextExample.markdown);
      setIsSourceOpen(false);
      setIsPresetsOpen(false);
      // Presets represent different documents, so discard transient editor state.
      editor.commands.resetMarkdown(nextExample.markdown);
      editor.flushChange();
      setMarkdownSource(editor.getMarkdown());
    };

    window.addEventListener("hashchange", handleHashChange);

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const dialog = isSourceOpen ? sourceDialogRef.current : isPresetsOpen ? presetsDialogRef.current : null;
    const trigger = isSourceOpen
      ? sourceTriggerRef.current ?? sourceButtonRef.current
      : isPresetsOpen ? presetsButtonRef.current : null;

    if (!dialog) {
      return;
    }

    const focusableSelector = "button:not(:disabled), textarea:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])";
    const focusableElements = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
    const initialFocus = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? focusableElements()[0] ?? dialog;
    const revealFocusedElement = (element: HTMLElement) => {
      element.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) {
        revealFocusedElement(event.target);
      }
    };
    dialog.addEventListener("focusin", handleFocusIn);
    initialFocus.focus({ preventScroll: true });
    revealFocusedElement(initialFocus);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (isSourceOpen) {
          cancelSourceEdit();
        } else {
          setIsPresetsOpen(false);
        }
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const elements = focusableElements();
      const first = elements[0];
      const last = elements[elements.length - 1];

      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener("keydown", handleKeyDown);

    return () => {
      dialog.removeEventListener("focusin", handleFocusIn);
      dialog.removeEventListener("keydown", handleKeyDown);

      if (trigger?.isConnected) {
        trigger.focus();
      } else {
        sourceButtonRef.current?.focus();
      }
    };
  }, [cancelSourceEdit, isPresetsOpen, isSourceOpen]);

  const activeExample = useMemo(
    () => devLabExamples.find((example) => example.slug === activeSlug) ?? DEFAULT_EXAMPLE,
    [activeSlug],
  );

  const loadExample = (example: DevExample) => {
    activeExampleRef.current = example;
    opaqueEditRequestRef.current = null;
    setOpaqueSourceKind(null);
    setActiveSlug(example.slug);
    setSourceDraft(example.markdown);
    window.history.replaceState(null, "", `${window.location.pathname}#${example.slug}`);

    if (!editorRef.current) {
      setMarkdownSource(example.markdown);
      return;
    }

    // Presets represent different documents, so discard transient editor state.
    editorRef.current.commands.resetMarkdown(example.markdown);
    editorRef.current.flushChange();
    setMarkdownSource(editorRef.current.getMarkdown());
    setIsPresetsOpen(false);
  };

  const applySource = () => {
    if (!editorRef.current) {
      return;
    }

    const opaqueRequest = opaqueEditRequestRef.current;

    if (opaqueRequest) {
      if (!opaqueRequest.update(opaqueSourceDraft)) {
        return;
      }

      editorRef.current.flushChange();
      setMarkdownSource(editorRef.current.getMarkdown());
      opaqueEditRequestRef.current = null;
      setOpaqueSourceKind(null);
      setIsSourceOpen(false);
      return;
    }

    // Source edits update the current document through mapped selection/history.
    editorRef.current.commands.reconcileMarkdown(sourceDraft);
    editorRef.current.flushChange();
    const nextMarkdown = editorRef.current.getMarkdown();
    setMarkdownSource(nextMarkdown);
    setSourceDraft(nextMarkdown);
    cancelSourceEdit();
  };

  return (
    <div className="dev-lab-shell">
      <section className="dev-lab-editor-panel">
        <div ref={editorElementRef} className="dev-lab-editor" />
      </section>

      <div className="dev-lab-floating-tools">
        <button
          ref={presetsButtonRef}
          type="button"
          className="dev-floating-button"
          aria-controls="dev-presets-dialog"
          aria-expanded={isPresetsOpen}
          aria-haspopup="dialog"
          onClick={() => {
            setIsPresetsOpen((open) => !open);
            setIsSourceOpen(false);
          }}
        >
          Presets
        </button>
        <button
          ref={sourceButtonRef}
          type="button"
          className="dev-floating-button"
          aria-controls="dev-source-dialog"
          aria-expanded={isSourceOpen}
          aria-haspopup="dialog"
          onClick={() => {
            if (isSourceOpen) {
              cancelSourceEdit();
              return;
            }

            sourceTriggerRef.current = sourceButtonRef.current;
            opaqueEditRequestRef.current = null;
            setOpaqueSourceKind(null);
            setSourceDraft(editorRef.current?.getMarkdown() ?? markdownSource);
            setIsSourceOpen(true);
            setIsPresetsOpen(false);
          }}
        >
          Markdown
        </button>
      </div>

      {isPresetsOpen ? (
        <div className="dev-modal-backdrop" onClick={() => setIsPresetsOpen(false)}>
          <section
            ref={presetsDialogRef}
            id="dev-presets-dialog"
            className="dev-modal dev-modal-presets"
            onClick={(event) => event.stopPropagation()}
            aria-label="Preset markdown examples"
            aria-modal="true"
            role="dialog"
            tabIndex={-1}
          >
            <div className="dev-modal-header">
              <div>
                <span className="card-kicker">Common verification scenarios</span>
                <h3>Load a saved markdown example</h3>
              </div>
              <button type="button" className="dev-modal-close" onClick={() => setIsPresetsOpen(false)}>
                Close
              </button>
            </div>
            <div className="dev-lab-example-buttons" role="group" aria-label="Markdown presets">
              {devLabExamples.map((example) => (
                <button
                  key={example.slug}
                  type="button"
                  data-autofocus={example.slug === activeSlug ? "true" : undefined}
                  aria-pressed={example.slug === activeSlug}
                  className={example.slug === activeSlug ? "dev-example-button is-active" : "dev-example-button"}
                  onClick={() => loadExample(example)}
                >
                  {example.slug}
                </button>
              ))}
            </div>
            <p className="dev-lab-example-description">{activeExample.description}</p>
          </section>
        </div>
      ) : null}

      {isSourceOpen ? (
        <div className="dev-modal-backdrop" onClick={cancelSourceEdit}>
          <section
            ref={sourceDialogRef}
            id="dev-source-dialog"
            className="dev-modal dev-modal-source"
            onClick={(event) => event.stopPropagation()}
            aria-label="Markdown source"
            aria-modal="true"
            role="dialog"
            tabIndex={-1}
          >
            <div className="dev-modal-header">
              <div>
                <span className="card-kicker">
                  {opaqueSourceKind ? `${opaqueSourceKind} source` : "Markdown source"}
                </span>
                <h3>{opaqueSourceKind ? "Edit preserved source" : "Edit source and reapply it"}</h3>
              </div>
              <div className="dev-modal-actions">
                <button type="button" className="button button-primary" onClick={applySource}>
                  {opaqueSourceKind ? "Save preserved source" : "Apply source"}
                </button>
                <button type="button" className="dev-modal-close" onClick={cancelSourceEdit}>
                  Cancel
                </button>
              </div>
            </div>
            <textarea
              className="dev-lab-source"
              data-autofocus="true"
              spellCheck={false}
              value={opaqueSourceKind ? opaqueSourceDraft : sourceDraft}
              onChange={(event) => {
                if (opaqueSourceKind) {
                  setOpaqueSourceDraft(event.target.value);
                } else {
                  setSourceDraft(event.target.value);
                }
              }}
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}
