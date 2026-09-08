import { describe, expect, it } from "vitest";
import { createMenuTypeahead, nextMenuIndex } from "../src/contextMenuNavigation";

describe("menu navigation", () => {
  it("wraps arrows and handles empty or initially unfocused panels", () => {
    expect(nextMenuIndex("ArrowDown", 2, 3)).toBe(0);
    expect(nextMenuIndex("ArrowUp", 0, 3)).toBe(2);
    expect(nextMenuIndex("ArrowUp", -1, 3)).toBe(2);
    expect(nextMenuIndex("Home", 2, 3)).toBe(0);
    expect(nextMenuIndex("End", 0, 3)).toBe(2);
    expect(nextMenuIndex("ArrowDown", -1, 0)).toBe(-1);
  });

  it("keeps multi-character matches, cycles repeated letters, and expires prefixes", () => {
    const search = createMenuTypeahead();
    const labels = ["Heading 1", "Heading 2", "Paragraph", "Paste"];
    expect(search.find(labels, 3, "h", 1000)).toBe(0);
    expect(search.find(labels, 0, "H", 1100)).toBe(1);
    search.reset();
    expect(search.find(labels, 1, "p", 1200)).toBe(2);
    expect(search.find(labels, 2, "a", 1300)).toBe(2);
    expect(search.find(labels, 2, "s", 1400)).toBe(3);
    expect(search.find(labels, 3, "h", 2200)).toBe(0);
  });

  it("keeps prefixes independent between nested panels", () => {
    const root = createMenuTypeahead();
    const child = createMenuTypeahead();
    expect(root.find(["Format"], 0, "f", 1000)).toBe(0);
    expect(root.find(["Format"], 0, "o", 1100)).toBe(0);
    expect(child.find(["Bold", "Italic"], 0, "i", 1200)).toBe(1);
    expect(child.find(["Bold", "Italic"], 1, "t", 1300)).toBe(1);
    root.reset();
    expect(root.find(["Paragraph"], 0, "p", 1400)).toBe(0);
  });
});
