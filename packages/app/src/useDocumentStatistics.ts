import { useEffect, useRef, useState } from "react";
import { countDocumentCharacters, countDocumentWords } from "./document";

export function useDocumentStatistics(markdown: string) {
  const latest = useRef(markdown);
  latest.current = markdown;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [statistics, setStatistics] = useState({ words: 0, characters: 0 });
  useEffect(() => {
    if (timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setStatistics({ words: countDocumentWords(latest.current), characters: countDocumentCharacters(latest.current) });
    }, 300);
  }, [markdown]);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; }, []);
  return statistics;
}
