import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createCompatibilityMarkdownCodec,
  type MarkdownEditorCodec,
} from "../src/markdownCodec";
import { createMinimalMarkdownCodec } from "../src/minimalMarkdownCodec";

interface CommonMarkCase {
  example: number;
  section: string;
  markdown: string;
}

interface CommonMarkFixture {
  schemaVersion: number;
  source: {
    id: string;
    title: string;
    url: string;
    license: string;
  };
  cases: CommonMarkCase[];
}

interface AuditFailure {
  example: number;
  section: string;
  semanticStable: boolean;
  serializationIdempotent: boolean;
}

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "markdown-conformance",
  "commonmark-0.31.2.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as CommonMarkFixture;

function audit(codec: MarkdownEditorCodec) {
  const failures: AuditFailure[] = [];

  for (const testCase of fixture.cases) {
    const document = codec.parse(testCase.markdown)!;
    const serialized = codec.serialize(document);
    const reparsed = codec.parse(serialized)!;
    const reserialized = codec.serialize(reparsed);
    const semanticStable = document.eq(reparsed);
    const serializationIdempotent = serialized === reserialized;

    if (!semanticStable || !serializationIdempotent) {
      failures.push({
        example: testCase.example,
        section: testCase.section,
        semanticStable,
        serializationIdempotent,
      });
    }
  }

  return failures;
}

const sharedReviewedFailures: AuditFailure[] = [
  { example: 76, section: "ATX headings", semanticStable: false, serializationIdempotent: false },
  { example: 320, section: "Lists", semanticStable: false, serializationIdempotent: false },
  { example: 321, section: "Lists", semanticStable: false, serializationIdempotent: false },
  { example: 418, section: "Emphasis and strong emphasis", semanticStable: false, serializationIdempotent: false },
  { example: 430, section: "Emphasis and strong emphasis", semanticStable: false, serializationIdempotent: false },
  { example: 432, section: "Emphasis and strong emphasis", semanticStable: false, serializationIdempotent: false },
];

describe("full CommonMark 0.31.2 semantic-stability audit", () => {
  it("retains the complete attributed 652-example source fixture", () => {
    expect(fixture).toMatchObject({
      schemaVersion: 1,
      source: {
        id: "commonmark-0.31.2",
        url: "https://spec.commonmark.org/0.31.2/",
        license: "CC BY-SA 4.0",
      },
    });
    expect(fixture.cases).toHaveLength(652);
    expect(fixture.cases.map(({ example }) => example)).toEqual(
      Array.from({ length: 652 }, (_, index) => index + 1),
    );
  });

  it("keeps every root result stable except the explicitly reviewed remaining cases", () => {
    expect(audit(createCompatibilityMarkdownCodec())).toEqual(sharedReviewedFailures);
  });

  it("keeps every minimal result stable except the explicitly reviewed remaining cases", () => {
    expect(audit(createMinimalMarkdownCodec())).toEqual([
      ...sharedReviewedFailures,
      {
        example: 606,
        section: "Autolinks",
        semanticStable: false,
        serializationIdempotent: false,
      },
    ]);
  });
});
