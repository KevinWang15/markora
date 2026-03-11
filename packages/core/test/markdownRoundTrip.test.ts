import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markdownSerializer, parseMarkdown } from '../src/markdownCodec';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'markdown-roundtrip');

function readFixture(path: string) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trimEnd();
}

describe('markdown codec round-trip fixtures', () => {
  const fixtureNames = readdirSync(fixtureDir)
    .filter((fileName) => fileName.endsWith('.input.md'))
    .map((fileName) => fileName.replace(/\.input\.md$/, ''))
    .sort();

  it('loads a small corpus of round-trip fixtures', () => {
    expect(fixtureNames.length).toBeGreaterThanOrEqual(4);
  });

  for (const fixtureName of fixtureNames) {
    it(`round-trips fixture: ${fixtureName}`, () => {
      const input = readFixture(join(fixtureDir, `${fixtureName}.input.md`));
      const expected = readFixture(join(fixtureDir, `${fixtureName}.expected.md`));
      const parsed = parseMarkdown(input);

      expect(parsed).not.toBeNull();

      const serialized = markdownSerializer.serialize(parsed!);
      expect(serialized).toBe(expected);

      const reparsed = parseMarkdown(serialized);
      expect(reparsed).not.toBeNull();
      expect(markdownSerializer.serialize(reparsed!)).toBe(expected);
    });
  }
});
