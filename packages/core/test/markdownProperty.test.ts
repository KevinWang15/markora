import { describe, expect, it } from 'vitest';
import {
  assertMarkdownNormalization,
  assertMarkdownSemanticStability,
  firstDifferingJsonPath,
  preserveEntireSource,
} from './support/markdownConformance';

const PROPERTY_SEED = 0x5eed_0003;
const GENERATED_CASE_COUNT = 128;

interface GeneratedMarkdownCase {
  caseId: string;
  markdown: string;
}

function createDeterministicRandom(seed: number) {
  let state = seed >>> 0;

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function createSupportedMarkdownCases(seed: number, count: number): GeneratedMarkdownCase[] {
  const random = createDeterministicRandom(seed);
  const words = [
    'alpha',
    'bravo',
    'cobalt',
    'delta',
    'ember',
    'forest',
    'gamma',
    'harbor',
    'indigo',
    'jasmine',
    'kilo',
    'lumen',
  ];

  const integer = (maximum: number) => Math.floor(random() * maximum);
  const pick = <T>(values: readonly T[]) => values[integer(values.length)]!;
  const word = () => pick(words);
  const phrase = () => `${word()} ${word()} ${word()}`;

  const inline = () => {
    const value = word();

    return pick([
      `${value} ${word()}`,
      `*${value} ${word()}*`,
      `**${value}**`,
      `~~${value}~~`,
      `\`${value}-${word()}\``,
      `[${value}](/docs/${value} "${value}")`,
      `![${value}](./images/${value}.png "${value}")`,
      `\\*${value}\\*`,
    ]);
  };

  const paragraph = () => `${phrase()} ${inline()} ${word()}`;
  const heading = () => `${'#'.repeat(1 + integer(6))} ${phrase()} ${inline()}`;
  const blockquote = () => paragraph().split('\n').map((line) => `> ${line}`).join('\n');
  const thematicBreak = () => pick(['---', '***', '___']);
  const hardBreakParagraph = () => `${phrase()}\\\n${phrase()}`;

  const bulletList = () => {
    const itemCount = 2 + integer(3);
    return Array.from({ length: itemCount }, () => `- ${phrase()} ${inline()}`).join('\n');
  };

  const orderedList = () => {
    const itemCount = 2 + integer(3);
    const start = 1 + integer(5);
    return Array.from({ length: itemCount }, (_, index) => `${start + index}. ${phrase()}`).join('\n');
  };

  const taskList = () => {
    const itemCount = 2 + integer(3);
    return Array.from(
      { length: itemCount },
      (_, index) => `- [${(index + integer(2)) % 2 === 0 ? ' ' : pick(['x', 'X'])}] ${phrase()}`,
    ).join('\n');
  };

  const fencedCode = () => {
    const language = pick(['ts', 'json', 'python', 'mermaid']);
    const body = language === 'json'
      ? `{ "${word()}": ${1 + integer(99)} }`
      : `${word()} = ${1 + integer(99)};\n${word()}(${word()});`;
    const fence = pick(['```', '~~~~']);
    return `${fence}${language}\n${body}\n${fence}`;
  };

  const pipeTable = () => {
    const columnCount = 2 + integer(3);
    const bodyRowCount = 1 + integer(3);
    const alignments = ['---', ':---', ':---:', '---:'] as const;
    const cell = () => pick([
      word(),
      `*${word()}*`,
      `**${word()}**`,
      `~~${word()}~~`,
      `\`${word()}\``,
      `[${word()}](/docs/${word()})`,
    ]);
    const row = () => `| ${Array.from({ length: columnCount }, cell).join(' | ')} |`;

    return [
      row(),
      `| ${Array.from({ length: columnCount }, () => pick(alignments)).join(' | ')} |`,
      ...Array.from({ length: bodyRowCount }, row),
    ].join('\n');
  };

  const blockFactories = [
    paragraph,
    heading,
    blockquote,
    thematicBreak,
    hardBreakParagraph,
    bulletList,
    orderedList,
    taskList,
    fencedCode,
    pipeTable,
  ] as const;

  return Array.from({ length: count }, (_, index) => {
    const blockCount = 2 + integer(5);
    const markdown = Array.from({ length: blockCount }, () => pick(blockFactories)()).join('\n\n');

    return {
      caseId: `generated-supported-${seed.toString(16)}-${String(index).padStart(3, '0')}`,
      markdown,
    };
  });
}

describe('Markdown conformance harness', () => {
  it('asserts an exact reviewed normalization and semantic stability together', () => {
    const result = assertMarkdownNormalization({
      caseId: 'harness-normalization-bullet-crlf',
      input: '- one\r\n- two\r\n',
      expected: '* one\n* two',
    });

    expect(result.serialized).toBe('* one\n* two');
  });

  it('can opt a canonical case into exact lexical preservation', () => {
    assertMarkdownSemanticStability({
      caseId: 'harness-exact-lexical-opt-in',
      markdown: 'canonical **markdown**',
      lexicalGuarantees: [preserveEntireSource()],
    });
  });

  it('reports the first differing JSON path deterministically', () => {
    expect(firstDifferingJsonPath(
      { content: [{ type: 'paragraph', attrs: { level: 1 } }] },
      { content: [{ type: 'paragraph', attrs: { level: 2 } }] },
    )).toEqual({
      path: '$.content[0].attrs.level',
      expected: 1,
      actual: 2,
    });
  });

  it('includes case, stage, path, expected, and actual in failure diagnostics', () => {
    expect(() => assertMarkdownSemanticStability({
      caseId: 'harness-diagnostic-probe',
      markdown: '_normalized emphasis_',
      lexicalGuarantees: [{
        id: 'emphasis-marker',
        capture(source) {
          return { marker: source[0] };
        },
      }],
    })).toThrowError([
      'Markdown conformance failure',
      'Case ID: harness-diagnostic-probe',
      'Stage: lexical:emphasis-marker',
      'First differing JSON path: $.marker',
      'Expected: "_"',
      'Actual: "*"',
    ].join('\n'));
  });
});

describe(`supported Markdown semantic properties (seed 0x${PROPERTY_SEED.toString(16)})`, () => {
  const generatedCases = createSupportedMarkdownCases(PROPERTY_SEED, GENERATED_CASE_COUNT);

  it('generates a substantial deterministic sample', () => {
    expect(generatedCases).toHaveLength(GENERATED_CASE_COUNT);
    expect(createSupportedMarkdownCases(PROPERTY_SEED, 3)).toEqual(generatedCases.slice(0, 3));
  });

  it.each(generatedCases)('$caseId survives parse -> serialize -> parse', (testCase) => {
    assertMarkdownSemanticStability(testCase);
  });
});
