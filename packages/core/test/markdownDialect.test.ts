import { describe, expect, it } from 'vitest';
import { markdownSerializer, parseMarkdown } from './support/currentMarkdownCodec';

function normalizeMarkdown(markdown: string) {
  return markdownSerializer.serialize(parseMarkdown(markdown));
}

function collectOpaqueNodes(markdown: string) {
  const nodes: Array<{ kind: string; source: string; type: string }> = [];

  parseMarkdown(markdown).descendants((node) => {
    if (node.type.name === 'raw_block' || node.type.name === 'raw_inline') {
      nodes.push({
        type: node.type.name,
        kind: node.attrs.kind,
        source: node.attrs.source,
      });
    }
  });

  return nodes;
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
      expected: '[docs](/guide "Guide")\n\n[guide]: /guide "Guide"',
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
      kind: 'frontmatter',
      source: '---\ntitle: Example\n---',
    },
    {
      construct: 'display math',
      input: '$$\nx + y\n$$',
      kind: 'display-math',
    },
    {
      construct: 'raw HTML blocks',
      input: '<div>\nhello\n</div>',
      kind: 'html-block',
    },
    {
      construct: 'directives',
      input: ':::note\nImportant\n:::',
      kind: 'directive-container',
    },
  ])('preserves recognized unsupported $construct as inert opaque source', ({ input, kind, source = input }) => {
    expect(() => parseMarkdown(input)).not.toThrow();
    expect(normalizeMarkdown(input)).toBe(input);
    expect(collectOpaqueNodes(input)).toEqual([{ type: 'raw_block', kind, source }]);
  });

  it.each([
    {
      construct: 'footnotes',
      input: 'Text[^1]\n\n[^1]: Note',
      output: 'Text[^1](Note)\n\n[^1]: Note',
      opaqueNodes: [{
        type: 'raw_block',
        kind: 'reference-definition',
        source: '[^1]: Note',
      }],
    },
    {
      construct: 'inline math',
      input: 'Inline $x + y$ math',
      output: 'Inline $x + y$ math',
      opaqueNodes: [],
    },
    {
      construct: 'GitHub callouts',
      input: '> [!NOTE]\n> Important',
      output: '> \\[!NOTE\\] Important',
      opaqueNodes: [],
    },
    {
      construct: 'TOC markers',
      input: '[TOC]',
      output: '\\[TOC\\]',
      opaqueNodes: [],
    },
  ])('characterizes the unreported fallback for unsupported $construct', ({ input, output, opaqueNodes }) => {
    expect(() => parseMarkdown(input)).not.toThrow();
    expect(normalizeMarkdown(input)).toBe(output);
    expect(collectOpaqueNodes(input)).toEqual(opaqueNodes);
  });

  it('treats Mermaid fences as generic code blocks, not diagram syntax', () => {
    const markdown = '~~~mermaid\ngraph TD; A-->B\n~~~';
    const parsed = parseMarkdown(markdown);

    expect(parsed.firstChild?.type.name).toBe('code_block');
    expect(parsed.firstChild?.attrs.params).toBe('mermaid');
    expect(normalizeMarkdown(markdown)).toBe('```mermaid\ngraph TD; A-->B\n```');
  });
});
