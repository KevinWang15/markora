import { countDocumentCharacters, countDocumentWords, parseDocumentOutline } from "./document";
import type { AnalysisRequest, AnalysisResult } from "./DocumentAnalysis";
const scope = globalThis as unknown as { onmessage: (event: MessageEvent<AnalysisRequest>) => void; postMessage: (result: AnalysisResult) => void };
scope.onmessage = ({ data }) => scope.postMessage({
  revision: data.revision,
  words: countDocumentWords(data.markdown),
  characters: countDocumentCharacters(data.markdown),
  outline: data.outline ? parseDocumentOutline(data.markdown) : [],
});
