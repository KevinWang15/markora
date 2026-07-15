import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertMarkdownSemanticStability } from './support/markdownConformance';

interface CorpusDocument {
  slug: string;
  category: string;
  markdown: string;
}

interface CorpusManifest {
  schemaVersion: number;
  description: string;
  provenance: string;
  reviewStatus: string;
  categories: string[];
  documents: CorpusDocument[];
}

const corpusPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'markdown-corpus',
  'curated-documents.json',
);
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as CorpusManifest;
const expectedCategories = [
  'adr',
  'api-documentation',
  'changelog',
  'checklist',
  'incident-report',
  'meeting-notes',
  'product-spec',
  'readme',
  'runbook',
  'tutorial',
] as const;

describe('curated real-world Markdown corpus', () => {
  it('is versioned and starts with 100 unique, balanced documents', () => {
    const slugs = corpus.documents.map((document) => document.slug);
    const categoryCounts = Object.fromEntries(expectedCategories.map((category) => [category, 0]));

    expect(corpus.schemaVersion).toBe(1);
    expect(corpus.description).not.toBe('');
    expect(corpus.provenance).toContain('no production or customer data');
    expect(corpus.reviewStatus).toBe('reviewed');
    expect(corpus.categories).toEqual(expectedCategories);
    expect(corpus.documents).toHaveLength(100);
    expect(new Set(slugs).size).toBe(slugs.length);

    for (const document of corpus.documents) {
      expect(document.slug, 'corpus document has no slug').toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(expectedCategories, `${document.slug} has an unknown category`).toContain(document.category);
      expect(document.markdown, `${document.slug} has no content`).toMatch(/^# /);
      expect(document.markdown.split(/\n\n+/).length, `${document.slug} is not multi-block`).toBeGreaterThanOrEqual(3);
      categoryCounts[document.category] += 1;
    }

    expect(categoryCounts).toEqual(Object.fromEntries(expectedCategories.map((category) => [category, 10])));
  });

  for (const document of corpus.documents) {
    it(`${document.category}/${document.slug} is semantically stable`, () => {
      assertMarkdownSemanticStability({
        caseId: `corpus:${document.category}/${document.slug}`,
        markdown: document.markdown,
      });
    });
  }
});
