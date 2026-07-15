import { markdownSerializer, parseMarkdown } from '../../src/markdownCodec';

export interface MarkdownLexicalGuarantee {
  /** A stable label shown in failure diagnostics. */
  id: string;
  /**
   * Select the lexical data that must survive the first serialization.
   * Return JSON-compatible data when a guarantee covers multiple fragments.
   */
  capture: (source: string) => unknown;
}

export interface MarkdownSemanticCase {
  caseId: string;
  markdown: string;
  lexicalGuarantees?: readonly MarkdownLexicalGuarantee[];
}

export interface MarkdownNormalizationCase {
  caseId: string;
  input: string;
  expected: string;
  lexicalGuarantees?: readonly MarkdownLexicalGuarantee[];
}

export interface MarkdownRoundTripResult {
  serialized: string;
  reserialized: string;
  parsedJson: unknown;
  reparsedJson: unknown;
}

export interface MarkdownSerializationResult {
  serialized: string;
  parsedJson: unknown;
}

interface JsonDifference {
  path: string;
  expected: unknown;
  actual: unknown;
}

interface FailureDetails extends JsonDifference {
  caseId: string;
  stage: string;
  cause?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function appendJsonPath(path: string, key: string) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

/** Returns the first stable, depth-first difference between two JSON-shaped values. */
export function firstDifferingJsonPath(expected: unknown, actual: unknown, path = '$'): JsonDifference | null {
  if (Object.is(expected, actual)) {
    return null;
  }

  if (Array.isArray(expected) && Array.isArray(actual)) {
    const sharedLength = Math.min(expected.length, actual.length);

    for (let index = 0; index < sharedLength; index += 1) {
      const difference = firstDifferingJsonPath(expected[index], actual[index], `${path}[${index}]`);

      if (difference) {
        return difference;
      }
    }

    if (expected.length !== actual.length) {
      return {
        path: `${path}.length`,
        expected: expected.length,
        actual: actual.length,
      };
    }

    return null;
  }

  if (isRecord(expected) && isRecord(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();

    for (const key of keys) {
      const keyPath = appendJsonPath(path, key);

      if (!Object.prototype.hasOwnProperty.call(expected, key)) {
        return { path: keyPath, expected: undefined, actual: actual[key] };
      }

      if (!Object.prototype.hasOwnProperty.call(actual, key)) {
        return { path: keyPath, expected: expected[key], actual: undefined };
      }

      const difference = firstDifferingJsonPath(expected[key], actual[key], keyPath);

      if (difference) {
        return difference;
      }
    }

    return null;
  }

  return { path, expected, actual };
}

function formatDiagnosticValue(value: unknown) {
  if (value === undefined) {
    return 'undefined';
  }

  let formatted: string;

  try {
    formatted = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    formatted = String(value);
  }

  const maximumLength = 1_200;
  return formatted.length <= maximumLength
    ? formatted
    : `${formatted.slice(0, maximumLength)}\n… (${formatted.length - maximumLength} more characters)`;
}

function describeCause(cause: unknown) {
  if (cause instanceof Error) {
    return cause.stack ?? cause.message;
  }

  return formatDiagnosticValue(cause);
}

function fail(details: FailureDetails): never {
  const lines = [
    'Markdown conformance failure',
    `Case ID: ${details.caseId}`,
    `Stage: ${details.stage}`,
    `First differing JSON path: ${details.path}`,
    `Expected: ${formatDiagnosticValue(details.expected)}`,
    `Actual: ${formatDiagnosticValue(details.actual)}`,
  ];

  if (details.cause !== undefined) {
    lines.push(`Cause: ${describeCause(details.cause)}`);
  }

  throw new Error(lines.join('\n'));
}

function assertJsonEqual(caseId: string, stage: string, expected: unknown, actual: unknown) {
  const difference = firstDifferingJsonPath(expected, actual);

  if (difference) {
    fail({ caseId, stage, ...difference });
  }
}

function parseForCase(caseId: string, stage: string, markdown: string) {
  try {
    const parsed = parseMarkdown(markdown);

    if (!parsed) {
      fail({
        caseId,
        stage,
        path: '$',
        expected: 'a parsed ProseMirror document',
        actual: parsed,
      });
    }

    return parsed;
  } catch (cause) {
    fail({
      caseId,
      stage,
      path: '$',
      expected: 'a successful parse',
      actual: cause instanceof Error ? cause.message : cause,
      cause,
    });
  }
}

function serializeForCase(
  caseId: string,
  stage: string,
  parsed: NonNullable<ReturnType<typeof parseMarkdown>>,
) {
  try {
    return markdownSerializer.serialize(parsed);
  } catch (cause) {
    fail({
      caseId,
      stage,
      path: '$.markdown',
      expected: 'a successful serialization',
      actual: cause instanceof Error ? cause.message : cause,
      cause,
    });
  }
}

function captureLexicalValue(
  caseId: string,
  guarantee: MarkdownLexicalGuarantee,
  sourceName: 'input' | 'serialized',
  source: string,
) {
  try {
    return guarantee.capture(source);
  } catch (cause) {
    fail({
      caseId,
      stage: `lexical:${guarantee.id}:capture-${sourceName}`,
      path: '$',
      expected: 'a successful lexical capture',
      actual: cause instanceof Error ? cause.message : cause,
      cause,
    });
  }
}

function assertLexicalGuarantees(
  caseId: string,
  input: string,
  serialized: string,
  guarantees: readonly MarkdownLexicalGuarantee[],
) {
  for (const guarantee of guarantees) {
    const expected = captureLexicalValue(caseId, guarantee, 'input', input);
    const actual = captureLexicalValue(caseId, guarantee, 'serialized', serialized);
    assertJsonEqual(caseId, `lexical:${guarantee.id}`, expected, actual);
  }
}

/**
 * Proves semantic stability for one supported Markdown case. Lexical guarantees
 * are deliberately opt-in because Markora otherwise emits canonical Markdown.
 */
export function assertMarkdownSemanticStability(testCase: MarkdownSemanticCase): MarkdownRoundTripResult {
  const parsed = parseForCase(testCase.caseId, 'parse-input', testCase.markdown);
  const serialized = serializeForCase(testCase.caseId, 'serialize-input', parsed);
  const reparsed = parseForCase(testCase.caseId, 'parse-serialized', serialized);
  const reserialized = serializeForCase(testCase.caseId, 'serialize-reparsed', reparsed);
  const parsedJson = parsed.toJSON();
  const reparsedJson = reparsed.toJSON();

  assertJsonEqual(testCase.caseId, 'semantic-stability', parsedJson, reparsedJson);
  assertJsonEqual(
    testCase.caseId,
    'serialization-idempotence',
    { markdown: serialized },
    { markdown: reserialized },
  );
  assertLexicalGuarantees(testCase.caseId, testCase.markdown, serialized, testCase.lexicalGuarantees ?? []);

  return { serialized, reserialized, parsedJson, reparsedJson };
}

/**
 * Asserts a reviewed first-pass output without claiming semantic stability.
 * This keeps known limitations visible without promoting them to guarantees.
 */
export function assertMarkdownReviewedOutput(
  testCase: MarkdownNormalizationCase,
): MarkdownSerializationResult {
  const parsed = parseForCase(testCase.caseId, 'parse-input', testCase.input);
  const serialized = serializeForCase(testCase.caseId, 'serialize-input', parsed);
  const parsedJson = parsed.toJSON();

  assertJsonEqual(
    testCase.caseId,
    'reviewed-output',
    { markdown: testCase.expected },
    { markdown: serialized },
  );
  assertLexicalGuarantees(testCase.caseId, testCase.input, serialized, testCase.lexicalGuarantees ?? []);

  return { serialized, parsedJson };
}

/** Proves both the reviewed canonical output and semantic stability of that output. */
export function assertMarkdownNormalization(testCase: MarkdownNormalizationCase): MarkdownRoundTripResult {
  const result = assertMarkdownSemanticStability({
    caseId: testCase.caseId,
    markdown: testCase.input,
    lexicalGuarantees: testCase.lexicalGuarantees,
  });

  assertJsonEqual(
    testCase.caseId,
    'normalization',
    { markdown: testCase.expected },
    { markdown: result.serialized },
  );

  return result;
}

/** Convenience guarantee for constructs that explicitly promise byte-for-byte preservation. */
export function preserveEntireSource(id = 'entire-source'): MarkdownLexicalGuarantee {
  return {
    id,
    capture(source) {
      return source;
    },
  };
}
