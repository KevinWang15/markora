import { describe, expect, it } from "vitest";
import { findNextGraphemeEnd, findPreviousGraphemeStart } from "../src/androidInput";

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

  it("uses direct segment lookup for long backward text when the runtime supports it", () => {
    const segments = {
      containing: () => ({ index: 999 }),
      *[Symbol.iterator](): IterableIterator<{ index: number }> {
        throw new Error("The iterable fallback should not run.");
      },
    };
    const intl = {
      Segmenter: class {
        segment() {
          return segments;
        }
      },
    } as unknown as typeof Intl;

    expect(findPreviousGraphemeStart("A".repeat(1_000), intl)).toBe(999);
  });

  it.each([
    ["😀A", 2],
    ["👩‍💻A", 5],
    ["éA", 2],
    ["👍🏽A", 4],
    ["🇨🇳A", 4],
  ])("finds the next grapheme boundary in %s", (text, expected) => {
    expect(findNextGraphemeEnd(text)).toBe(expected);
  });

  it("falls forward by a complete code point when Intl.Segmenter is unavailable", () => {
    expect(findNextGraphemeEnd("😀A", {} as typeof Intl)).toBe(2);
  });
});
