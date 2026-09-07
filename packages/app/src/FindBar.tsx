import { useEffect, useRef } from "react";
import type { SearchOptions, SearchResults } from "./search";

export function FindBar({ options, onOptions, replacement, onReplacement, results, index, focusRequest, onNext, onReplace, onClose }: {
  options: SearchOptions; onOptions: (options: SearchOptions) => void;
  replacement: string; onReplacement: (text: string) => void;
  results: SearchResults; index: number; focusRequest: number;
  onNext: (direction: 1 | -1) => void; onReplace: (all: boolean) => void; onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [focusRequest]);
  return <div className="app-find-bar" role="search" aria-label="Find and replace" onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    else if (event.key === "Enter") { event.preventDefault(); onNext(event.shiftKey ? -1 : 1); }
  }}>
    <div className="app-find-row">
      <input ref={input} aria-label="Find text" placeholder="Find in document" value={options.query} onChange={event => onOptions({ ...options, query: event.target.value })} />
      <span className="app-find-count" role="status">{results.truncated ? `${results.matches.length}+ matches` : index >= 0 && index < results.matches.length ? `${index + 1} of ${results.matches.length}` : `${results.matches.length} matches`}</span>
      <button type="button" disabled={!results.matches.length} onClick={() => onNext(-1)} aria-label="Previous match">↑</button>
      <button type="button" disabled={!results.matches.length} onClick={() => onNext(1)} aria-label="Next match">↓</button>
      <button type="button" onClick={onClose} aria-label="Close find and replace">×</button>
    </div>
    <div className="app-find-row">
      <input aria-label="Replacement text" placeholder="Replace with" value={replacement} onChange={event => onReplacement(event.target.value)} />
      <button type="button" disabled={index < 0 || !results.matches.length} onClick={() => onReplace(false)}>Replace</button>
      <button type="button" disabled={!results.matches.length || results.truncated} onClick={() => onReplace(true)}>Replace all</button>
      <label><input type="checkbox" checked={options.caseSensitive} onChange={event => onOptions({ ...options, caseSensitive: event.target.checked })} />Match case</label>
      <label><input type="checkbox" checked={options.wholeWord} onChange={event => onOptions({ ...options, wholeWord: event.target.checked })} />Whole word</label>
    </div>
    {results.truncated && <p>Refine your search to navigate or replace beyond the first {results.matches.length.toLocaleString()} matches.</p>}
  </div>;
}
