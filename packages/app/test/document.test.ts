import { describe, expect, it } from "vitest";
import {
  countDocumentCharacters,
  countDocumentWords,
  documentNameFromPath,
  extractOpenPath,
  isMarkdownPath,
  parseCommandLineArguments,
  parseDocumentOutline,
  upsertRecentDocument,
} from "../src/document";

describe("desktop document model", () => {
  it("builds an outline from headings while ignoring fenced source", () => {
    expect(parseDocumentOutline([
      "# Project **plan**",
      "",
      "## [Milestones](https://example.com)",
      "```md",
      "# Not a heading",
      "```",
      "### Ship",
    ].join("\n"))).toEqual([
      { id: "heading-1", level: 1, offset: 0, text: "Project plan" },
      { id: "heading-2", level: 2, offset: 20, text: "Milestones" },
      { id: "heading-3", level: 3, offset: 83, text: "Ship" },
    ]);
  });

  it("counts readable words and non-whitespace characters", () => {
    expect(countDocumentWords("Write calm software. 写得好。")).toBeGreaterThanOrEqual(5);
    expect(countDocumentCharacters("a b\n文")).toBe(3);
  });

  it("recognizes supported documents on both path styles", () => {
    expect(documentNameFromPath("C:\\Notes\\release.markdown")).toBe("release.markdown");
    expect(isMarkdownPath("/tmp/README.MD")).toBe(true);
    expect(isMarkdownPath("/tmp/image.png")).toBe(false);
  });

  it("parses quoted startup arguments without damaging Windows paths", () => {
    expect(parseCommandLineArguments('--flag "C:\\My Notes\\today.md"')).toEqual([
      "--flag",
      "C:\\My Notes\\today.md",
    ]);
    expect(extractOpenPath(["--flag", "/tmp/today.md"])).toBe("/tmp/today.md");
  });

  it("deduplicates and limits recent documents", () => {
    const initial = [
      { name: "one.md", path: "/tmp/one.md", touchedAt: 1 },
      { name: "two.md", path: "/tmp/two.md", touchedAt: 2 },
    ];
    expect(upsertRecentDocument(initial, "/tmp/two.md", 3, 2)).toEqual([
      { name: "two.md", path: "/tmp/two.md", touchedAt: 3 },
      { name: "one.md", path: "/tmp/one.md", touchedAt: 1 },
    ]);
  });
});

describe("source outline syntax", () => {
  it("includes Setext and nested headings without stripping literal hashes", () => {
    expect(parseDocumentOutline("First\n=====\n\n## C#\n\n> ### Nested\n").map(item => item.text)).toEqual(["First", "C#", "Nested"]);
  });
  it("honors fence lengths and retains CRLF source offsets", () => {
    const source = "````md\r\n```\r\n# Hidden\r\n````\r\n\r\n# Actual";
    expect(parseDocumentOutline(source)).toEqual([{ id: "heading-1", level: 1, text: "Actual", offset: source.indexOf("# Actual") }]);
  });
});
