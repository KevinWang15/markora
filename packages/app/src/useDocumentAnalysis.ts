import { useEffect, useRef, useState } from "react";
import { DocumentAnalysis, type AnalysisRequest, type AnalysisResult } from "./DocumentAnalysis";

export function useDocumentAnalysis(markdown: string, outline: boolean) {
  const scheduler = useRef<DocumentAnalysis | null>(null);
  const [result, setResult] = useState<AnalysisResult & { markdown: string | null; outlineEnabled: boolean }>({ revision: 0, words: 0, characters: 0, outline: [], markdown: null, outlineEnabled: false });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const worker = new Worker(new URL("./documentAnalysis.worker.ts", import.meta.url), { type: "module" });
    let active: AnalysisRequest;
    const analysis = new DocumentAnalysis(request => { active = request; worker.postMessage(request); }, result => {
      setResult({ ...result, markdown: active.markdown, outlineEnabled: active.outline });
    });
    scheduler.current = analysis;
    worker.onmessage = event => analysis.receive(event.data as AnalysisResult);
    worker.onerror = () => setError("Document outline and statistics are unavailable. Reopen the app to retry.");
    return () => { scheduler.current = null; worker.terminate(); };
  }, []);
  useEffect(() => {
    scheduler.current!.schedule(markdown, outline);
    const timer = setTimeout(() => scheduler.current?.flush(), 300);
    return () => clearTimeout(timer);
  }, [markdown, outline]);
  return { ...result, stale: result.markdown !== markdown || result.outlineEnabled !== outline, error };
}
