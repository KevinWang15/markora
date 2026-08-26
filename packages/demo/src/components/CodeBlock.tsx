import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatLanguageLabel, highlightCode } from "../lib/highlightCode";

type CodeBlockProps = {
  code: string;
  language?: string;
  title?: string;
  showLineNumbers?: boolean;
  className?: string;
};

export function CodeBlock({
  code,
  language,
  title,
  showLineNumbers = code.includes("\n"),
  className,
}: CodeBlockProps) {
  const [copyFeedback, setCopyFeedback] = useState<"copied" | "failed" | "idle">("idle");
  const copyStatusId = useId();
  const resetTimerRef = useRef<number | null>(null);
  const highlightedLines = useMemo(() => highlightCode(code, language), [code, language]);
  const showHeader = Boolean(title || language);
  const lineCount = highlightedLines.length;
  const languageLabel = language ? formatLanguageLabel(language) : null;
  const codeDescription = title
    ? `${title}${languageLabel ? ` (${languageLabel})` : ""} code`
    : languageLabel ? `${languageLabel} code` : "code";
  const copyStatus = copyFeedback === "copied"
    ? `${codeDescription} copied to the clipboard.`
    : copyFeedback === "failed"
      ? `Could not copy ${codeDescription}. Select the code and copy it manually.`
      : "";

  useEffect(() => () => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
  }, []);

  async function handleCopy() {
    let nextFeedback: "copied" | "failed" = "copied";

    try {
      const clipboard = navigator.clipboard;
      if (typeof clipboard?.writeText !== "function") {
        throw new Error("Clipboard writing is unavailable.");
      }
      await clipboard.writeText(code);
    } catch {
      nextFeedback = "failed";
    }

    setCopyFeedback(nextFeedback);

    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }

    resetTimerRef.current = window.setTimeout(() => {
      setCopyFeedback("idle");
      resetTimerRef.current = null;
    }, nextFeedback === "failed" ? 4000 : 1600);
  }

  return (
    <figure className={["code-block", showLineNumbers ? "has-line-numbers" : "", className].filter(Boolean).join(" ")}>
      {showHeader ? (
        <figcaption className="code-block-header">
          <div className="code-block-meta">
            {title ? <span className="code-block-title">{title}</span> : null}
            {languageLabel ? <span className="code-block-language">{languageLabel}</span> : null}
          </div>
          <button
            type="button"
            className="code-block-copy"
            aria-label={`Copy ${codeDescription}`}
            aria-describedby={copyFeedback === "idle" ? undefined : copyStatusId}
            onClick={() => void handleCopy()}
          >
            {copyFeedback === "copied" ? "Copied" : copyFeedback === "failed" ? "Copy failed" : "Copy"}
          </button>
          <span className="visually-hidden" id={copyStatusId} role="status" aria-live="polite">
            {copyStatus}
          </span>
        </figcaption>
      ) : null}

      <pre className="code-block-pre" data-code-description={codeDescription}>
        <code className="code-block-code">
          {highlightedLines.map((line, lineIndex) => (
            <span key={`${lineIndex}-${lineCount}`} className="code-block-line">
              {showLineNumbers ? (
                <span className="code-block-line-number" aria-hidden="true">{lineIndex + 1}</span>
              ) : null}
              <span className="code-block-line-content">
                {line.length === 0 ? "\n" : line.map((token, tokenIndex) => (
                  <span key={`${lineIndex}-${tokenIndex}`} className={token.className}>{token.text}</span>
                ))}
              </span>
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}
