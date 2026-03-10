import { createEditor, type MarkdownEditor } from "markora";
import { createDefaultUi } from "markora-ui";
import { useEffect, useMemo, useRef, useState } from "react";
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
  const activeExampleRef = useRef<DevExample>(getExampleFromHash(window.location.hash));
  const [activeSlug, setActiveSlug] = useState(activeExampleRef.current.slug);
  const [markdownSource, setMarkdownSource] = useState(activeExampleRef.current.markdown);
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const [isPresetsOpen, setIsPresetsOpen] = useState(false);

  useEffect(() => {
    const editorElement = editorElementRef.current;

    if (!editorElement) {
      return;
    }

    const editor = createEditor({
      element: editorElement,
      markdown: activeExampleRef.current.markdown,
      onChangeMode: "animationFrame",
      ui: createDefaultUi(),
      onChange(markdown) {
        setMarkdownSource(markdown);
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
      setActiveSlug(nextExample.slug);
      editor.commands.setMarkdown(nextExample.markdown);
      editor.flushChange();
      setMarkdownSource(editor.getMarkdown());
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSourceOpen(false);
        setIsPresetsOpen(false);
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener("keydown", handleKeyDown);
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  const activeExample = useMemo(
    () => devLabExamples.find((example) => example.slug === activeSlug) ?? DEFAULT_EXAMPLE,
    [activeSlug],
  );

  const loadExample = (example: DevExample) => {
    activeExampleRef.current = example;
    setActiveSlug(example.slug);
    window.history.replaceState(null, "", `${window.location.pathname}#${example.slug}`);

    if (!editorRef.current) {
      setMarkdownSource(example.markdown);
      return;
    }

    editorRef.current.commands.setMarkdown(example.markdown);
    editorRef.current.flushChange();
    setMarkdownSource(editorRef.current.getMarkdown());
    setIsPresetsOpen(false);
  };

  const applySource = () => {
    if (!editorRef.current) {
      return;
    }

    editorRef.current.commands.setMarkdown(markdownSource);
    editorRef.current.flushChange();
    setMarkdownSource(editorRef.current.getMarkdown());
    setIsSourceOpen(false);
  };

  return (
    <div className="dev-lab-shell">
      <section className="dev-lab-editor-panel">
        <div ref={editorElementRef} className="dev-lab-editor" />
      </section>

      <div className="dev-lab-floating-tools">
        <button
          type="button"
          className="dev-floating-button"
          onClick={() => {
            setIsPresetsOpen((open) => !open);
            setIsSourceOpen(false);
          }}
        >
          Presets
        </button>
        <button
          type="button"
          className="dev-floating-button"
          onClick={() => {
            setIsSourceOpen((open) => !open);
            setIsPresetsOpen(false);
          }}
        >
          Markdown
        </button>
      </div>

      {isPresetsOpen ? (
        <div className="dev-modal-backdrop" onClick={() => setIsPresetsOpen(false)}>
          <section
            className="dev-modal dev-modal-presets"
            onClick={(event) => event.stopPropagation()}
            aria-label="Preset markdown examples"
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
            <div className="dev-lab-example-buttons">
              {devLabExamples.map((example) => (
                <button
                  key={example.slug}
                  type="button"
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
        <div className="dev-modal-backdrop" onClick={() => setIsSourceOpen(false)}>
          <section
            className="dev-modal dev-modal-source"
            onClick={(event) => event.stopPropagation()}
            aria-label="Markdown source"
          >
            <div className="dev-modal-header">
              <div>
                <span className="card-kicker">Markdown source</span>
                <h3>Edit source and reapply it</h3>
              </div>
              <div className="dev-modal-actions">
                <button type="button" className="button button-primary" onClick={applySource}>
                  Apply source
                </button>
                <button type="button" className="dev-modal-close" onClick={() => setIsSourceOpen(false)}>
                  Close
                </button>
              </div>
            </div>
            <textarea
              className="dev-lab-source"
              spellCheck={false}
              value={markdownSource}
              onChange={(event) => setMarkdownSource(event.target.value)}
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}
