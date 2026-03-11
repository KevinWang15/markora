import { useEffect, useMemo, useRef, useState } from "react";
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
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);
  const highlightedLines = useMemo(() => highlightCode(code, language), [code, language]);
  const showHeader = Boolean(title || language);
  const lineCount = highlightedLines.length;

  useEffect(() => () => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
  }, []);

  async function handleCopy() {
    if (!navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
    } catch {
      return;
    }

    setCopied(true);

    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }

    resetTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      resetTimerRef.current = null;
    }, 1600);
  }

  return (
    <figure className={["code-block", showLineNumbers ? "has-line-numbers" : "", className].filter(Boolean).join(" ")}>
      {showHeader ? (
        <div className="code-block-header">
          <div className="code-block-meta">
            {title ? <figcaption className="code-block-title">{title}</figcaption> : null}
            {language ? <span className="code-block-language">{formatLanguageLabel(language)}</span> : null}
          </div>
          <button type="button" className="code-block-copy" onClick={() => void handleCopy()}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : null}

      <pre className="code-block-pre">
        <code className="code-block-code">
          {highlightedLines.map((line, lineIndex) => (
            <span key={`${lineIndex}-${lineCount}`} className="code-block-line">
              {showLineNumbers ? (
                <span className="code-block-line-number" aria-hidden="true">{lineIndex + 1}</span>
              ) : null}
              <span className="code-block-line-content">
                {line.length === 0 ? "\u200b" : line.map((token, tokenIndex) => (
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
