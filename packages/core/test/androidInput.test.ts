import { describe, expect, it } from "vitest";
import { findPreviousGraphemeStart } from "../src/androidInput";

describe("Android input fallback", () => {
  it.each([
    ["A😀", 1],
    ["A👩‍💻", 1],
    ["Aé", 1],
    ["A👍🏽", 1],
    ["A🇨🇳", 1],
  ])("finds the previous grapheme boundary in %s", (text, expected) => {
    expect(findPreviousGraphemeStart(text)).toBe(expected);
  });

  it("falls back to a complete code point when Intl.Segmenter is unavailable", () => {
    expect(findPreviousGraphemeStart("A😀", {} as typeof Intl)).toBe(1);
  });
});
