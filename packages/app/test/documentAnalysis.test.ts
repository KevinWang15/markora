import { describe, expect, it } from "vitest";
import { DocumentAnalysis, type AnalysisRequest, type AnalysisResult } from "../src/DocumentAnalysis";
import { mapTextPosition, textChange } from "../src/textChanges";

describe("background document analysis", () => {
  it("coalesces edits and never publishes an outline for a superseded document", () => {
    const requests: AnalysisRequest[] = [], results: AnalysisResult[] = [];
    const analysis = new DocumentAnalysis(request => requests.push(request), result => results.push(result));
    analysis.schedule("old", true); analysis.flush();
    analysis.schedule("middle", true); analysis.flush();
    analysis.schedule("new document", true); analysis.flush();
    expect(requests.map(request => request.markdown)).toEqual(["old"]);
    analysis.receive({ revision: 1, words: 1, characters: 3, outline: [] });
    expect(results).toHaveLength(0);
    expect(requests.map(request => request.markdown)).toEqual(["old", "new document"]);
    analysis.receive({ revision: 3, words: 2, characters: 11, outline: [] });
    expect(results).toHaveLength(1);
  });
});

it("keeps a source caret anchored when preceding rich text changes", () => {
  const change = textChange("before\n\nkeep this", "longer before\n\nkeep this");
  expect(mapTextPosition(10, change)).toBe(17);
  const removal = textChange("remove this\nkeep", "keep");
  expect(mapTextPosition(3, removal)).toBe(0);
});
