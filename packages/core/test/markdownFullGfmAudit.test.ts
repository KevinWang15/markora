import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createMarkdownCodec,
  type MarkdownEditorCodec,
} from "../src/markdownCodec";
import { createMinimalMarkdownCodec } from "../src/minimalMarkdownCodec";

interface GfmCase {
  example: number;
  section: string;
  extensions: string[];
  markdown: string;
}

interface GfmFixture {
  schemaVersion: number;
  source: {
    id: string;
    title: string;
    url: string;
    input: string;
    sha256: string;
    license: string;
  };
  cases: GfmCase[];
}

interface AuditFailure {
  example: number;
  section: string;
  extensions: string[];
  semanticStable: boolean;
  serializationIdempotent: boolean;
}

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "markdown-conformance",
  "gfm-0.29.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as GfmFixture;

function audit(codec: MarkdownEditorCodec, cases: readonly GfmCase[]) {
  const failures: AuditFailure[] = [];

  for (const testCase of cases) {
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
        extensions: testCase.extensions,
        semanticStable,
        serializationIdempotent,
      });
    }
  }

  return failures;
}

describe("full GFM 0.29 semantic-stability audit", () => {
  it("retains the complete attributed 672-example source fixture", () => {
    expect(fixture).toMatchObject({
      schemaVersion: 1,
      source: {
        id: "gfm-0.29",
        url: "https://github.github.com/gfm/",
        input: "https://raw.githubusercontent.com/github/cmark-gfm/828322d1ee4facdab56f0d3edccb13e9af90dcd2/test/spec.txt",
        sha256: "7d8e5814befec287ac116786d81ff14e0adc9b13295b4494649e995408fd871c",
        license: "CC BY-SA 4.0",
      },
    });
    expect(fixture.cases).toHaveLength(672);
    expect(fixture.cases.map(({ example }) => example)).toEqual(
      Array.from({ length: 672 }, (_, index) => index + 1),
    );
  });

  it("keeps every root result semantically stable and serialization-idempotent", () => {
    expect(audit(createMarkdownCodec(), fixture.cases)).toEqual([]);
  });

  it("keeps every non-extension minimal result stable and idempotent", () => {
    expect(audit(
      createMinimalMarkdownCodec(),
      fixture.cases.filter(testCase => testCase.extensions.length === 0),
    )).toEqual([]);
  });
});
