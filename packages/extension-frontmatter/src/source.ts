import type { FrontmatterMessages } from "./messages";
import type {
  Node as ProseMirrorNode,
  NodeType,
  Transaction,
} from "markora/extension-api";

export const FRONTMATTER_MAX_SOURCE_BYTES = 65_536;
const FRONTMATTER_MAX_ALIAS_REFERENCES = 50;
const FRONTMATTER_MAX_NESTING_DEPTH = 32;

export const frontmatterDiagnosticCodes = [
  "alias-limit",
  "custom-tag",
  "invalid-structure",
  "nesting-limit",
  "source-too-large",
  "tab-indentation",
  "unbalanced-flow",
] as const;

export type FrontmatterDiagnosticCode = (typeof frontmatterDiagnosticCodes)[number];

export type FrontmatterDiagnostic = Readonly<{
  code: FrontmatterDiagnosticCode;
  message: string;
  severity: "error" | "warning";
}>;

export type FrontmatterSnapshot = Readonly<{
  diagnostics: readonly FrontmatterDiagnostic[];
  source: string;
}>;

const mappingEntryPattern = /^(?:[A-Za-z_][A-Za-z0-9_.-]*|["'][^"']+["']):(?:[ \t]|$)/;
const utf8Encoder = new TextEncoder();

export function isFrontmatterMappingLine(line: string) {
  return mappingEntryPattern.test(line.trimStart());
}

export function splitFrontmatterLines(source: string) {
  return source.split(/\r\n|\r|\n/);
}

export function hasFrontmatterEnvelope(source: string) {
  const lines = splitFrontmatterLines(source);
  const opener = lines[0]?.replace(/^\uFEFF/, "") ?? "";
  const closer = lines[lines.length - 1] ?? "";

  return (
    /^---[ \t]*$/.test(opener)
    && /^(?:---|\.\.\.)[ \t]*$/.test(closer)
    && lines.slice(1, -1).some(isFrontmatterMappingLine)
  );
}

function readNodeSource(node: ProseMirrorNode) {
  return typeof node.attrs.source === "string" ? node.attrs.source : "";
}

export function frontmatterAtHead(doc: ProseMirrorNode, nodeType: NodeType) {
  return doc.firstChild?.type === nodeType ? doc.firstChild : null;
}

function hasValidFrontmatterPlacement(doc: ProseMirrorNode, nodeType: NodeType) {
  let count = 0;
  let valid = true;

  doc.descendants((node, position) => {
    if (node.type === nodeType) {
      count += 1;
      valid &&= position === 0 && hasFrontmatterEnvelope(readNodeSource(node));
    }
  });

  return valid && count <= 1;
}

function serializedStepContainsNodeType(value: unknown, nodeName: string): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => serializedStepContainsNodeType(entry, nodeName));
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return record.type === nodeName || Object.values(record).some((entry) => (
    serializedStepContainsNodeType(entry, nodeName)
  ));
}

function stepTouchesDocumentHead(
  step: Transaction["steps"][number],
  serializedStep: unknown,
) {
  if (
    typeof serializedStep === "object"
    && serializedStep !== null
    && (serializedStep as { pos?: unknown }).pos === 0
  ) {
    return true;
  }

  let touchesHead = false;
  step.getMap().forEach((oldStart, oldEnd) => {
    touchesHead ||= oldStart === 0 || (oldStart < 1 && oldEnd > 0);
  });
  return touchesHead;
}

function transactionNeedsPlacementValidation(
  transaction: Transaction,
  nodeType: NodeType,
) {
  const hadFrontmatter = frontmatterAtHead(transaction.before, nodeType) !== null;

  for (const step of transaction.steps) {
    let serializedStep: unknown;

    try {
      serializedStep = step.toJSON();
    } catch {
      return true;
    }

    if (
      serializedStepContainsNodeType(serializedStep, nodeType.name)
      || (hadFrontmatter && stepTouchesDocumentHead(step, serializedStep))
    ) {
      return true;
    }
  }

  return false;
}

export function isFrontmatterPlacementTransactionAllowed(
  transaction: Transaction,
  nodeType: NodeType,
) {
  return !transaction.docChanged
    || !transactionNeedsPlacementValidation(transaction, nodeType)
    || hasValidFrontmatterPlacement(transaction.doc, nodeType);
}

function pushDiagnostic(
  diagnostics: FrontmatterDiagnostic[],
  code: FrontmatterDiagnosticCode,
  message: string,
  severity: FrontmatterDiagnostic["severity"],
) {
  diagnostics.push(Object.freeze({ code, message, severity }));
}

function isQuoteStart(line: string, index: number) {
  const previous = line[index - 1];
  return previous === undefined || /[\s:[{,?\-]/.test(previous);
}

function isTokenBoundary(line: string, index: number) {
  const previous = line[index - 1];
  return previous === undefined || /[\s,[{:?\-]/.test(previous);
}

function inspectYamlLexically(lines: readonly string[]) {
  const flowStack: Array<"[" | "{"> = [];
  const indentationLevels: number[] = [];
  let aliasReferences = 0;
  let balanced = true;
  let blockScalarParentIndent: number | null = null;
  let hasCustomTag = false;
  let maximumIndentationDepth = 0;
  let maximumDepth = 0;
  let quote: "\"" | "'" | null = null;
  let escaped = false;

  for (const line of lines) {
    const indentation = /^ */.exec(line)?.[0].length ?? 0;
    const trimmed = line.trim();

    if (blockScalarParentIndent !== null) {
      if (!trimmed || indentation > blockScalarParentIndent) {
        continue;
      }

      blockScalarParentIndent = null;
    }

    if (trimmed && !trimmed.startsWith("#")) {
      while (
        indentationLevels.length > 0
        && indentationLevels[indentationLevels.length - 1]! >= indentation
      ) {
        indentationLevels.pop();
      }

      indentationLevels.push(indentation);
      maximumIndentationDepth = Math.max(
        maximumIndentationDepth,
        indentationLevels.length - 1,
      );
    }

    let visible = "";

    for (let index = 0; index < line.length; index += 1) {
      const character = line[index]!;

      if (quote) {
        visible += " ";

        if (escaped) {
          escaped = false;
        } else if (character === "\\" && quote === "\"") {
          escaped = true;
        } else if (character === quote) {
          if (quote === "'" && line[index + 1] === "'") {
            visible += " ";
            index += 1;
          } else {
            quote = null;
          }
        }
        continue;
      }

      if (
        (character === "\"" || character === "'")
        && isQuoteStart(line, index)
      ) {
        quote = character;
        visible += " ";
        continue;
      }

      if (
        character === "#"
        && (index === 0 || /\s/.test(line[index - 1]!))
      ) {
        break;
      }

      visible += character;

      if (
        character === "!"
        && isTokenBoundary(line, index)
        && line[index + 1] !== undefined
        && !/\s/.test(line[index + 1]!)
      ) {
        hasCustomTag = true;
      } else if (
        character === "*"
        && isTokenBoundary(line, index)
        && /[A-Za-z0-9_-]/.test(line[index + 1] ?? "")
      ) {
        aliasReferences += 1;
      } else if (character === "[" || character === "{") {
        flowStack.push(character);
        maximumDepth = Math.max(maximumDepth, flowStack.length);
      } else if (character === "]" || character === "}") {
        const expected = character === "]" ? "[" : "{";

        if (flowStack.pop() !== expected) {
          balanced = false;
        }
      }
    }

    if (
      /(?:^\s*-\s*|:\s*)[>|](?:[1-9][+-]?|[+-][1-9]?)?\s*$/.test(visible)
    ) {
      blockScalarParentIndent = indentation;
    }
  }

  return {
    aliasReferences,
    balanced: balanced && flowStack.length === 0,
    hasCustomTag,
    maximumDepth,
    maximumIndentationDepth,
  };
}

export function analyzeFrontmatterSource(
  source: string,
  messages: FrontmatterMessages,
): readonly FrontmatterDiagnostic[] {
  const diagnostics: FrontmatterDiagnostic[] = [];
  const sourceIsTooLarge = source.length > FRONTMATTER_MAX_SOURCE_BYTES
    || utf8Encoder.encode(source).byteLength > FRONTMATTER_MAX_SOURCE_BYTES;

  if (sourceIsTooLarge) {
    pushDiagnostic(
      diagnostics,
      "source-too-large",
      messages.sourceTooLargeDiagnostic,
      "error",
    );
    return Object.freeze(diagnostics);
  }

  const lines = splitFrontmatterLines(source);
  const body = lines.slice(1, -1);

  if (!hasFrontmatterEnvelope(source)) {
    pushDiagnostic(
      diagnostics,
      "invalid-structure",
      messages.invalidStructureDiagnostic,
      "error",
    );
  }

  if (body.some((line) => /^ *\t/.test(line))) {
    pushDiagnostic(
      diagnostics,
      "tab-indentation",
      messages.tabIndentationDiagnostic,
      "warning",
    );
  }

  const inspection = inspectYamlLexically(body);

  if (inspection.hasCustomTag) {
    pushDiagnostic(
      diagnostics,
      "custom-tag",
      messages.customTagDiagnostic,
      "warning",
    );
  }

  if (inspection.aliasReferences > FRONTMATTER_MAX_ALIAS_REFERENCES) {
    pushDiagnostic(
      diagnostics,
      "alias-limit",
      messages.aliasLimitDiagnostic,
      "error",
    );
  }

  if (!inspection.balanced) {
    pushDiagnostic(
      diagnostics,
      "unbalanced-flow",
      messages.unbalancedFlowDiagnostic,
      "error",
    );
  }

  if (
    inspection.maximumDepth > FRONTMATTER_MAX_NESTING_DEPTH
    || inspection.maximumIndentationDepth > FRONTMATTER_MAX_NESTING_DEPTH
  ) {
    pushDiagnostic(
      diagnostics,
      "nesting-limit",
      messages.nestingLimitDiagnostic,
      "error",
    );
  }

  return Object.freeze(diagnostics);
}
