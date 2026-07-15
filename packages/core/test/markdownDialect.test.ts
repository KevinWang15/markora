import { describe, expect, it } from 'vitest';
import { markdownSerializer, parseMarkdown } from '../src/markdownCodec';

function normalizeMarkdown(markdown: string) {
  return markdownSerializer.serialize(parseMarkdown(markdown));
}

describe('published Markdown dialect contract', () => {
  it.each([
    {
      behavior: 'bullet markers',
      input: '- one\n- two',
      expected: '* one\n* two',
    },
    {
      behavior: 'soft breaks, excess blank lines, and the terminal newline',
      input: 'alpha\nbeta\n\n\n\ngamma\n',
      expected: 'alpha beta\n\ngamma',
    },
    {
      behavior: 'hard-break spelling',
      input: 'alpha  \nbeta',
      expected: 'alpha\\\nbeta',
    },
    {
      behavior: 'reference links',
      input: '[docs][guide]\n\n[guide]: /guide "Guide"',
      expected: '[docs](/guide "Guide")',
    },
    {
      behavior: 'escapes and entities',
      input: '\\*literal\\* and &amp;',
      expected: '\\*literal\\* and &',
    },
    {
      behavior: 'line endings',
      input: 'alpha\r\n\r\nbeta\r\n',
      expected: 'alpha\n\nbeta',
    },
    {
      behavior: 'heading and emphasis spelling',
      input: 'Heading\n=======\n\n_em_ and __strong__',
      expected: '# Heading\n\n*em* and **strong**',
    },
    {
      behavior: 'fence markers',
      input: '~~~ts\nconst answer = 42;\n~~~',
      expected: '```ts\nconst answer = 42;\n```',
    },
    {
      behavior: 'task-list case and marker spelling',
      input: '- [X] Done\n- [ ] Todo',
      expected: '* [x] Done\n* [ ] Todo',
    },
  ])('normalizes $behavior', ({ input, expected }) => {
    expect(normalizeMarkdown(input)).toBe(expected);
    expect(normalizeMarkdown(expected)).toBe(expected);
  });

  it.each([
    {
      construct: 'YAML front matter',
      input: '---\ntitle: Example\n---\n\nBody',
      output: '---\n\n## title: Example\n\nBody',
    },
    {
      construct: 'footnotes',
      input: 'Text[^1]\n\n[^1]: Note',
      output: 'Text[^1](Note)',
    },
    {
      construct: 'display math',
      input: '$$\nx + y\n$$',
      output: '$$ x + y $$',
    },
    {
      construct: 'GitHub callouts',
      input: '> [!NOTE]\n> Important',
      output: '> \\[!NOTE\\] Important',
    },
    {
      construct: 'raw HTML blocks',
      input: '<div>\nhello\n</div>',
      output: '<div> hello </div>',
    },
    {
      construct: 'directives',
      input: ':::note\nImportant\n:::',
      output: ':::note Important :::',
    },
    {
      construct: 'TOC markers',
      input: '[TOC]',
      output: '\\[TOC\\]',
    },
  ])('does not promise preservation or an error for unsupported $construct', ({ input, output }) => {
    expect(() => parseMarkdown(input)).not.toThrow();
    expect(normalizeMarkdown(input)).toBe(output);
    expect(output).not.toBe(input);
  });

  it('treats Mermaid fences as generic code blocks, not diagram syntax', () => {
    const markdown = '~~~mermaid\ngraph TD; A-->B\n~~~';
    const parsed = parseMarkdown(markdown);

    expect(parsed.firstChild?.type.name).toBe('code_block');
    expect(parsed.firstChild?.attrs.params).toBe('mermaid');
    expect(normalizeMarkdown(markdown)).toBe('```mermaid\ngraph TD; A-->B\n```');
  });
});
