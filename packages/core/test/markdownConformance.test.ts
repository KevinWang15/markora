import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertMarkdownNormalization,
  assertMarkdownReviewedOutput,
} from './support/markdownConformance';

type ConformanceClassification =
  | 'supported-normalized'
  | 'security-normalized'
  | 'boundary-characterized'
  | 'known-limitation'
  | 'unsupported-characterized';

interface ConformanceSource {
  id: string;
  title: string;
  url: string;
  license: string;
}

interface ConformanceCase {
  id: string;
  source: string;
  section: string;
  url: string;
  classification: ConformanceClassification;
  semanticStability?: 'required' | 'known-failing';
  input: string;
  expected: string;
  note?: string;
}

interface ConformanceManifest {
  schemaVersion: number;
  lexicalGuarantees: string[];
  sources: ConformanceSource[];
  cases: ConformanceCase[];
}

const testDirectory = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(
  join(testDirectory, 'fixtures', 'markdown-conformance', 'spec-cases.json'),
  'utf8',
)) as ConformanceManifest;

describe('versioned Markdown conformance manifest', () => {
  const allowedClassifications: ConformanceClassification[] = [
    'supported-normalized',
    'security-normalized',
    'boundary-characterized',
    'known-limitation',
    'unsupported-characterized',
  ];

  it('pins authoritative CommonMark and GFM sources', () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.sources).toEqual([
      expect.objectContaining({
        id: 'commonmark-0.31.2',
        url: 'https://spec.commonmark.org/0.31.2/',
        license: 'CC BY-SA 4.0',
      }),
      expect.objectContaining({
        id: 'gfm-0.29',
        url: 'https://github.github.com/gfm/',
        license: 'CC BY-SA 4.0',
      }),
    ]);
  });

  it('contains unique, attributable, reviewed cases', () => {
    const sourceIds = new Set(manifest.sources.map((source) => source.id));
    const caseIds = manifest.cases.map((testCase) => testCase.id);

    expect(manifest.cases.length).toBeGreaterThanOrEqual(40);
    expect(new Set(caseIds).size).toBe(caseIds.length);

    for (const testCase of manifest.cases) {
      expect(sourceIds.has(testCase.source), `${testCase.id} has an unknown source`).toBe(true);
      expect(allowedClassifications, `${testCase.id} has an unknown classification`).toContain(testCase.classification);
      expect(testCase.url, `${testCase.id} has no source URL`).toMatch(/^https:\/\//);
      expect(testCase.section, `${testCase.id} has no section`).not.toBe('');
      expect(testCase.input, `${testCase.id} has no input`).not.toBe('');
      expect(typeof testCase.expected, `${testCase.id} has no reviewed output`).toBe('string');

      if (testCase.classification === 'known-limitation') {
        expect(['required', 'known-failing'], `${testCase.id} has no semantic-stability policy`)
          .toContain(testCase.semanticStability);
      } else {
        expect(testCase.semanticStability, `${testCase.id} has a redundant semantic-stability override`)
          .toBeUndefined();
      }
    }
  });

  it('covers the supported block, inline, and GFM extension families', () => {
    const commonMarkSections = new Set(
      manifest.cases.filter((testCase) => testCase.source === 'commonmark-0.31.2')
        .map((testCase) => testCase.section),
    );
    const gfmSections = new Set(
      manifest.cases.filter((testCase) => testCase.source === 'gfm-0.29')
        .map((testCase) => testCase.section),
    );

    expect([...commonMarkSections]).toEqual(expect.arrayContaining([
      'Backslash escapes',
      'Fenced code blocks',
      'Lists',
      'Emphasis and strong emphasis',
      'Links',
      'Images',
      'Hard line breaks',
    ]));
    expect([...gfmSections]).toEqual(expect.arrayContaining([
      'Tables',
      'Task list items',
      'Strikethrough',
      'Autolinks',
    ]));
  });

  it('explains every security, boundary, unsupported, and known-limitation case', () => {
    for (const testCase of manifest.cases) {
      if (testCase.classification === 'supported-normalized') {
        continue;
      }

      expect(testCase.note, `${testCase.id} has no classification rationale`).toBeTruthy();
    }
  });

  it('matches the published bounded lexical round-trip guarantee', () => {
    const compatibilityContract = readFileSync(join(testDirectory, '..', 'MARKDOWN_COMPATIBILITY.md'), 'utf8');

    expect(manifest.lexicalGuarantees).toEqual([
      'Top-level valid CommonMark link-reference definition source is retained exactly inside each root source block.',
    ]);
    expect(compatibilityContract).toContain('| Lexical round-trip | Original bytes, markers, escapes, whitespace, and reference definitions survive. | Valid top-level CommonMark link-reference definitions in the root entry');
  });
});

describe('reviewed CommonMark and GFM cases', () => {
  for (const testCase of manifest.cases) {
    it(`${testCase.id} · ${testCase.section} · ${testCase.classification}`, () => {
      const assertion = {
        caseId: testCase.id,
        input: testCase.input,
        expected: testCase.expected,
      };

      if (testCase.semanticStability === 'known-failing') {
        assertMarkdownReviewedOutput(assertion);
        return;
      }

      assertMarkdownNormalization(assertion);
    });
  }
});
