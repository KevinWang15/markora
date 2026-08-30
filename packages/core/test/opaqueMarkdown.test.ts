import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOMParser as ProseMirrorDOMParser,
  DOMSerializer,
  type Node as ProseMirrorNode,
} from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import {
  defineMarkdownEditorExtension,
  readMarkdownEditorOpaqueTokenSource,
} from '../src/extension-api';
import { resolveMarkdownEditorExtensions } from '../src/extensionResolver';
import { MARKORA_VERSION } from '../src/extensionVersion';
import { createMarkdownCodec } from '../src/markdownCodec';
import {
  markdownSerializer,
  parseMarkdown,
  schema,
} from './support/currentMarkdownCodec';

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

describe('opaque token exact-source API', () => {
  it('reads only own data properties and never invokes hostile accessors', () => {
    expect(readMarkdownEditorOpaqueTokenSource({
      meta: { markoraOpaqueSource: '<aside>\r\nsource\r\n</aside>' },
    })).toBe('<aside>\r\nsource\r\n</aside>');
    expect(readMarkdownEditorOpaqueTokenSource(null)).toBeNull();
    expect(readMarkdownEditorOpaqueTokenSource({})).toBeNull();
    expect(readMarkdownEditorOpaqueTokenSource(Object.create({
      meta: { markoraOpaqueSource: 'inherited' },
    }))).toBeNull();
    expect(readMarkdownEditorOpaqueTokenSource({
      meta: Object.create({ markoraOpaqueSource: 'inherited' }),
    })).toBeNull();
    expect(readMarkdownEditorOpaqueTokenSource(new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new Error('foreign proxy');
      },
    }))).toBeNull();

    let metaReads = 0;
    const tokenWithAccessor = Object.defineProperty({}, 'meta', {
      enumerable: true,
      get() {
        metaReads += 1;
        throw new Error('must not run');
      },
    });
    expect(readMarkdownEditorOpaqueTokenSource(tokenWithAccessor)).toBeNull();
    expect(metaReads).toBe(0);

    let sourceReads = 0;
    const metaWithAccessor = Object.defineProperty({}, 'markoraOpaqueSource', {
      enumerable: true,
      get() {
        sourceReads += 1;
        throw new Error('must not run');
      },
    });
    expect(readMarkdownEditorOpaqueTokenSource({ meta: metaWithAccessor })).toBeNull();
    expect(sourceReads).toBe(0);
  });

  it('exposes hydrated block and inline HTML spans with exact authored line endings', () => {
    const captured: string[] = [];
    const probe = defineMarkdownEditorExtension({
      name: 'acme-opaque-source-probe',
      version: '1.0.0',
      compatibility: {
        extensionApi: '^1.3.0',
        markora: '^0.0.1',
      },
      markdown: {
        tokenizerRules: [{
          id: 'capture-html-source',
          phase: 'core',
          after: ['@markora/opaque/inline-source'],
          createRule: () => (state) => {
            for (const token of state.tokens) {
              if (token.type === 'html_block') {
                const source = readMarkdownEditorOpaqueTokenSource(token);
                if (source !== null) captured.push(source);
              }

              for (const child of token.children ?? []) {
                if (child.type !== 'html_inline') continue;
                const source = readMarkdownEditorOpaqueTokenSource(child);
                if (source !== null) captured.push(source);
              }
            }
          },
        }],
      },
    });
    const resolution = resolveMarkdownEditorExtensions({
      extensions: [probe],
      markoraVersion: MARKORA_VERSION,
    });
    const codec = createMarkdownCodec(resolution.extensions);
    const block = '<div data-kind="exact">\r\nblock\r\n</div>';
    const inline = '<!-- inline\r\ncomment -->';

    codec.parse(`${block}\r\n\r\nBefore ${inline} after.\r\n`);

    expect(captured).toEqual([block, inline]);
  });
});

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
      'reference-definition',
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

    expect(manifest.cases).toHaveLength(26);
    expect(new Set(caseIds).size).toBe(caseIds.length);
    expect(classificationCounts).toEqual({
      'opaque-block': 14,
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
