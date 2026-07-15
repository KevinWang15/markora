import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOMParser as ProseMirrorDOMParser,
  DOMSerializer,
  type Node as ProseMirrorNode,
} from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { markdownSerializer, parseMarkdown, schema } from '../src/markdownCodec';

type OpaqueClassification = 'opaque-block' | 'opaque-inline' | 'negative';

interface OpaqueNodeExpectation {
  kind: string;
  source: string;
}

interface OpaqueCase {
  id: string;
  classification: OpaqueClassification;
  note?: string;
  input: string;
  expected: string;
  opaqueNodes: OpaqueNodeExpectation[];
}

interface OpaqueManifest {
  schemaVersion: number;
  description: string;
  reviewStatus: string;
  opaqueKinds: string[];
  cases: OpaqueCase[];
}

const testDirectory = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(
  join(testDirectory, 'fixtures', 'opaque-markdown', 'cases.json'),
  'utf8',
)) as OpaqueManifest;

function collectOpaqueNodes(doc: ProseMirrorNode) {
  const nodes: Array<OpaqueNodeExpectation & { type: 'raw_block' | 'raw_inline' }> = [];

  doc.descendants((node) => {
    if (node.type.name !== 'raw_block' && node.type.name !== 'raw_inline') {
      return;
    }

    nodes.push({
      type: node.type.name,
      kind: node.attrs.kind,
      source: node.attrs.source,
    });
  });

  return nodes;
}

function collectOpaqueAttrs(doc: ProseMirrorNode): OpaqueNodeExpectation[] {
  return collectOpaqueNodes(doc).map(({ kind, source }) => ({ kind, source }));
}

describe('versioned opaque Markdown fixture manifest', () => {
  const allowedClassifications: OpaqueClassification[] = ['opaque-block', 'opaque-inline', 'negative'];

  it('has the reviewed schema and unique declared opaque kinds', () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.reviewStatus).toBe('reviewed');
    expect(manifest.description.trim()).not.toBe('');
    expect(manifest.opaqueKinds).toEqual([
      'frontmatter',
      'display-math',
      'html-block',
      'html-comment',
      'directive-container',
      'directive-leaf',
      'inline-html',
      'inline-directive',
      'unknown-fence',
    ]);
    expect(new Set(manifest.opaqueKinds).size).toBe(manifest.opaqueKinds.length);
  });

  it('has unique case IDs and the reviewed classification counts', () => {
    const caseIds = manifest.cases.map((testCase) => testCase.id);
    const classificationCounts = Object.fromEntries(allowedClassifications.map((classification) => [
      classification,
      manifest.cases.filter((testCase) => testCase.classification === classification).length,
    ]));

    expect(manifest.cases).toHaveLength(25);
    expect(new Set(caseIds).size).toBe(caseIds.length);
    expect(classificationCounts).toEqual({
      'opaque-block': 13,
      'opaque-inline': 3,
      negative: 9,
    });
  });

  it('contains complete expectations and rationale for every negative detector case', () => {
    const declaredKinds = new Set(manifest.opaqueKinds);

    for (const testCase of manifest.cases) {
      expect(testCase.id, 'fixture case has an invalid ID').toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(allowedClassifications, `${testCase.id} has an unknown classification`)
        .toContain(testCase.classification);
      expect(testCase.input, `${testCase.id} has no input`).not.toBe('');
      expect(typeof testCase.expected, `${testCase.id} has no expected serialization`).toBe('string');
      expect(Array.isArray(testCase.opaqueNodes), `${testCase.id} has no opaque-node expectations`).toBe(true);

      if (testCase.note !== undefined) {
        expect(testCase.note.trim(), `${testCase.id} has an empty note`).not.toBe('');
      }

      if (testCase.classification === 'negative') {
        expect(testCase.note?.trim(), `${testCase.id} must explain its negative-detection boundary`).toBeTruthy();
        expect(testCase.opaqueNodes, `${testCase.id} is negative but declares opaque nodes`).toEqual([]);
      } else {
        expect(testCase.opaqueNodes.length, `${testCase.id} does not declare an opaque node`)
          .toBeGreaterThan(0);
      }

      for (const opaqueNode of testCase.opaqueNodes) {
        expect(declaredKinds.has(opaqueNode.kind), `${testCase.id} uses undeclared kind ${opaqueNode.kind}`)
          .toBe(true);
        expect(opaqueNode.source, `${testCase.id} has an empty opaque source`).not.toBe('');
      }
    }
  });
});

describe('opaque Markdown parsing and exact serialization', () => {
  for (const testCase of manifest.cases) {
    it(`${testCase.id} · ${testCase.classification}`, () => {
      const parsed = parseMarkdown(testCase.input);
      const parsedOpaqueNodes = collectOpaqueNodes(parsed);

      expect(collectOpaqueAttrs(parsed)).toEqual(testCase.opaqueNodes);

      if (testCase.classification === 'opaque-block') {
        expect(parsedOpaqueNodes.every((node) => node.type === 'raw_block')).toBe(true);
      } else if (testCase.classification === 'opaque-inline') {
        expect(parsedOpaqueNodes.every((node) => node.type === 'raw_inline')).toBe(true);
      } else {
        expect(parsedOpaqueNodes).toEqual([]);
      }

      const serialized = markdownSerializer.serialize(parsed);
      expect(serialized).toBe(testCase.expected);

      const reparsed = parseMarkdown(serialized);
      expect(reparsed.toJSON()).toEqual(parsed.toJSON());
      expect(collectOpaqueAttrs(reparsed)).toEqual(testCase.opaqueNodes);
      expect(markdownSerializer.serialize(reparsed)).toBe(serialized);
    });
  }
});

describe('opaque Markdown clipboard DOM safety', () => {
  it('round-trips hostile raw block and inline source without authoring active DOM nodes', () => {
    const blockSource = [
      '<script>globalThis.__markoraExecuted = true;</script>',
      '<img src="x" onerror="globalThis.__markoraExecuted = true">',
      '<iframe srcdoc="<script>globalThis.__markoraExecuted = true</script>"></iframe>',
      '</code></pre><script>globalThis.__markoraExecuted = true</script>',
    ].join('\n');
    const inlineSource = '<img src=x onerror=alert(1)><iframe srcdoc="hostile"></iframe><script>alert(1)</script>';
    const rawBlock = schema.nodes.raw_block.create({ kind: 'html-block', source: blockSource });
    const rawInline = schema.nodes.raw_inline.create({ kind: 'inline-html', source: inlineSource });
    const originalDoc = schema.nodes.doc.create(null, [
      rawBlock,
      schema.nodes.paragraph.create(null, [schema.text('Before '), rawInline, schema.text(' after.')]),
    ]);
    const serializedContainer = document.createElement('div');
    const serializedFragment = DOMSerializer.fromSchema(schema).serializeFragment(originalDoc.content, { document });
    serializedContainer.append(serializedFragment);

    expect(serializedContainer.querySelectorAll('script, img, iframe')).toHaveLength(0);
    expect(serializedContainer.textContent).toContain(blockSource);
    expect(serializedContainer.textContent).toContain(inlineSource);

    const clipboardContainer = document.createElement('div');
    clipboardContainer.innerHTML = serializedContainer.innerHTML;

    expect(clipboardContainer.querySelectorAll('script, img, iframe')).toHaveLength(0);

    const reparsed = ProseMirrorDOMParser.fromSchema(schema).parse(clipboardContainer);
    expect(collectOpaqueAttrs(reparsed)).toEqual([
      { kind: 'html-block', source: blockSource },
      { kind: 'inline-html', source: inlineSource },
    ]);
    expect(clipboardContainer.querySelectorAll('script, img, iframe')).toHaveLength(0);
  });
});
