/**
 * A deliberately small, dependency-free SemVer 2.0 evaluator for extension
 * metadata. It accepts exact versions, comparator sets, `||`, hyphen ranges,
 * caret/tilde ranges, partial versions, and `x`/`*` wildcards. It intentionally
 * does not accept npm-specific aliases, tags, or whitespace-free comparator
 * chains such as `>=1<2`.
 */

export type MarkdownEditorParsedSemVer = Readonly<{
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly (number | string)[];
}>;

type ComparatorOperator = "<" | "<=" | ">" | ">=" | "=";

type Comparator = Readonly<{
  operator: ComparatorOperator;
  version: MarkdownEditorParsedSemVer;
}>;

type ComparatorSet = readonly Comparator[];

const numericIdentifier = /^(?:0|[1-9]\d*)$/;
const identifier = /^[0-9A-Za-z-]+$/;

function parseNumericIdentifier(value: string) {
  if (!numericIdentifier.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseMarkdownEditorSemVer(
  value: string,
): MarkdownEditorParsedSemVer | null {
  const match = value.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([^+]+))?(?:\+(.+))?$/,
  );

  if (!match) {
    return null;
  }

  const major = parseNumericIdentifier(match[1]);
  const minor = parseNumericIdentifier(match[2]);
  const patch = parseNumericIdentifier(match[3]);

  if (major === null || minor === null || patch === null) {
    return null;
  }

  const prerelease: (number | string)[] = [];

  if (match[4] !== undefined) {
    const parts = match[4].split(".");

    for (const part of parts) {
      if (!part || !identifier.test(part)) {
        return null;
      }

      if (/^\d+$/.test(part)) {
        const numeric = parseNumericIdentifier(part);

        if (numeric === null) {
          return null;
        }

        prerelease.push(numeric);
      } else {
        prerelease.push(part);
      }
    }
  }

  if (match[5] !== undefined) {
    const buildIdentifiers = match[5].split(".");

    if (buildIdentifiers.some((part) => !part || !identifier.test(part))) {
      return null;
    }
  }

  return Object.freeze({
    major,
    minor,
    patch,
    prerelease: Object.freeze(prerelease),
  });
}

function comparePrerelease(
  left: MarkdownEditorParsedSemVer,
  right: MarkdownEditorParsedSemVer,
) {
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length
      ? 0
      : left.prerelease.length === 0 ? 1 : -1;
  }

  const length = Math.max(left.prerelease.length, right.prerelease.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];

    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    }

    if (leftPart === rightPart) {
      continue;
    }

    if (typeof leftPart === "number" && typeof rightPart === "number") {
      return leftPart < rightPart ? -1 : 1;
    }

    if (typeof leftPart === "number" || typeof rightPart === "number") {
      return typeof leftPart === "number" ? -1 : 1;
    }

    return leftPart < rightPart ? -1 : 1;
  }

  return 0;
}

function compareSemVer(
  left: MarkdownEditorParsedSemVer,
  right: MarkdownEditorParsedSemVer,
) {
  for (const field of ["major", "minor", "patch"] as const) {
    if (left[field] !== right[field]) {
      return left[field] < right[field] ? -1 : 1;
    }
  }

  return comparePrerelease(left, right);
}

function createVersion(
  major: number,
  minor: number,
  patch: number,
  prerelease: readonly (number | string)[] = [],
): MarkdownEditorParsedSemVer {
  return { major, minor, patch, prerelease };
}

type PartialVersion = Readonly<{
  major?: number;
  minor?: number;
  patch?: number;
  prerelease?: readonly (number | string)[];
}>;

function parsePartialVersion(value: string): PartialVersion | null {
  const exact = parseMarkdownEditorSemVer(value);

  if (exact) {
    return exact;
  }

  const match = value.match(
    /^(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/,
  );

  if (!match) {
    return null;
  }

  const parts: (number | undefined)[] = [];

  for (const part of match.slice(1, 4)) {
    if (part === undefined || /^[xX*]$/.test(part)) {
      parts.push(undefined);
      continue;
    }

    const numeric = parseNumericIdentifier(part);

    if (numeric === null) {
      return null;
    }

    parts.push(numeric);
  }

  if (parts[0] === undefined && parts.some((part) => part !== undefined)) {
    return null;
  }

  if (parts[1] === undefined && parts[2] !== undefined) {
    return null;
  }

  return {
    major: parts[0],
    minor: parts[1],
    patch: parts[2],
  };
}

function lowerBound(version: PartialVersion) {
  return createVersion(
    version.major ?? 0,
    version.minor ?? 0,
    version.patch ?? 0,
    version.prerelease,
  );
}

function partialUpperBound(version: PartialVersion) {
  if (version.major === undefined) {
    return null;
  }

  if (version.minor === undefined) {
    return createVersion(version.major + 1, 0, 0);
  }

  if (version.patch === undefined) {
    return createVersion(version.major, version.minor + 1, 0);
  }

  return null;
}

function comparator(operator: ComparatorOperator, version: MarkdownEditorParsedSemVer): Comparator {
  return { operator, version };
}

function compileBarePartial(version: PartialVersion): Comparator[] {
  if (version.major === undefined) {
    return [];
  }

  const upper = partialUpperBound(version);

  if (upper) {
    return [comparator(">=", lowerBound(version)), comparator("<", upper)];
  }

  return [comparator("=", lowerBound(version))];
}

function compileCaret(version: PartialVersion): Comparator[] | null {
  if (version.major === undefined) {
    return [];
  }

  const lower = lowerBound(version);
  let upper: MarkdownEditorParsedSemVer;

  if (lower.major > 0) {
    upper = createVersion(lower.major + 1, 0, 0);
  } else if (version.minor === undefined) {
    upper = createVersion(1, 0, 0);
  } else if (lower.minor > 0) {
    upper = createVersion(0, lower.minor + 1, 0);
  } else if (version.patch === undefined) {
    upper = createVersion(0, 1, 0);
  } else {
    upper = createVersion(0, 0, lower.patch + 1);
  }

  return [comparator(">=", lower), comparator("<", upper)];
}

function compileTilde(version: PartialVersion): Comparator[] | null {
  if (version.major === undefined) {
    return [];
  }

  const lower = lowerBound(version);
  const upper = version.minor === undefined
    ? createVersion(lower.major + 1, 0, 0)
    : createVersion(lower.major, lower.minor + 1, 0);
  return [comparator(">=", lower), comparator("<", upper)];
}

function compileComparatorToken(token: string): Comparator[] | null {
  const match = token.match(/^(<=|>=|<|>|=|\^|~)?(.+)$/);

  if (!match) {
    return null;
  }

  const operator = match[1] ?? "";
  const parsed = parsePartialVersion(match[2]);

  if (!parsed) {
    return null;
  }

  if (operator === "^") {
    return compileCaret(parsed);
  }

  if (operator === "~") {
    return compileTilde(parsed);
  }

  if (operator === "" || operator === "=") {
    return compileBarePartial(parsed);
  }

  if (
    parsed.major === undefined
    || parsed.minor === undefined
    || parsed.patch === undefined
  ) {
    return null;
  }

  return [comparator(operator as ComparatorOperator, lowerBound(parsed))];
}

function compileHyphenRange(clause: string): ComparatorSet | null {
  const match = clause.match(/^(\S+)\s+-\s+(\S+)$/);

  if (!match) {
    return null;
  }

  const lower = parsePartialVersion(match[1]);
  const upper = parsePartialVersion(match[2]);

  if (!lower || !upper || lower.major === undefined || upper.major === undefined) {
    return null;
  }

  const upperExclusive = partialUpperBound(upper);
  return [
    comparator(">=", lowerBound(lower)),
    upperExclusive
      ? comparator("<", upperExclusive)
      : comparator("<=", lowerBound(upper)),
  ];
}

function compileComparatorSet(clause: string): ComparatorSet | null {
  const hyphen = compileHyphenRange(clause);

  if (hyphen) {
    return hyphen;
  }

  const tokens = clause.split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return null;
  }

  const comparators: Comparator[] = [];

  for (const token of tokens) {
    const compiled = compileComparatorToken(token);

    if (!compiled) {
      return null;
    }

    comparators.push(...compiled);
  }

  return comparators;
}

function compileRange(range: string): readonly ComparatorSet[] | null {
  if (range.trim() !== range || range.length === 0) {
    return null;
  }

  const clauses = range.split("||").map((clause) => clause.trim());

  if (clauses.some((clause) => clause.length === 0)) {
    return null;
  }

  const compiled: ComparatorSet[] = [];

  for (const clause of clauses) {
    const comparatorSet = compileComparatorSet(clause);

    if (!comparatorSet) {
      return null;
    }

    compiled.push(comparatorSet);
  }

  return compiled;
}

function satisfiesComparator(
  version: MarkdownEditorParsedSemVer,
  target: Comparator,
) {
  const compared = compareSemVer(version, target.version);

  switch (target.operator) {
    case "<":
      return compared < 0;
    case "<=":
      return compared <= 0;
    case ">":
      return compared > 0;
    case ">=":
      return compared >= 0;
    case "=":
      return compared === 0;
  }
}

function comparatorSetAllowsPrerelease(
  version: MarkdownEditorParsedSemVer,
  comparators: ComparatorSet,
) {
  if (version.prerelease.length === 0) {
    return true;
  }

  return comparators.some(({ version: target }) => (
    target.prerelease.length > 0
    && target.major === version.major
    && target.minor === version.minor
    && target.patch === version.patch
  ));
}

export function isValidMarkdownEditorSemVerRange(range: string) {
  return compileRange(range) !== null;
}

export function markdownEditorSemVerSatisfies(
  version: string,
  range: string,
) {
  const parsedVersion = parseMarkdownEditorSemVer(version);
  const comparatorSets = compileRange(range);

  if (!parsedVersion || !comparatorSets) {
    return false;
  }

  return comparatorSets.some((comparators) => (
    comparatorSetAllowsPrerelease(parsedVersion, comparators)
    && comparators.every((target) => satisfiesComparator(parsedVersion, target))
  ));
}
