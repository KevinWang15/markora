export type CodeToken = {
  text: string;
  className?: string;
};

export type CodeLine = CodeToken[];

const scriptKeywords = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "delete",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "of",
  "return",
  "static",
  "switch",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
]);

const scriptLiterals = new Set(["false", "null", "true", "undefined"]);
const knownTypes = new Set(["Array", "HTMLElement", "Promise", "Record", "Map", "Set"]);
const shellCommands = new Set(["bun", "node", "npm", "npx", "pnpm", "yarn"]);
const shellKeywords = new Set(["add", "create", "dev", "exec", "install", "run", "test"]);

function pushSegment(lines: CodeLine[], text: string, className?: string) {
  if (!text) {
    return;
  }

  const parts = text.split("\n");

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];

    if (part) {
      const currentLine = lines[lines.length - 1];
      const previous = currentLine[currentLine.length - 1];

      if (previous && previous.className === className) {
        previous.text += part;
      } else {
        currentLine.push({ text: part, className });
      }
    }

    if (index < parts.length - 1) {
      lines.push([]);
    }
  }
}

function isIdentifierStart(character: string) {
  return /[A-Za-z_$]/.test(character);
}

function isIdentifierPart(character: string) {
  return /[\w$]/.test(character);
}

function findPreviousMeaningfulCharacter(source: string, start: number) {
  for (let index = start - 1; index >= 0; index -= 1) {
    const character = source[index];

    if (!/\s/.test(character)) {
      return character;
    }
  }

  return "";
}

function findNextMeaningfulCharacter(source: string, start: number) {
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];

    if (!/\s/.test(character)) {
      return character;
    }
  }

  return "";
}

function readQuotedSegment(source: string, start: number, quote: string) {
  let index = start + 1;

  while (index < source.length) {
    const character = source[index];

    if (character === "\\") {
      index += 2;
      continue;
    }

    if (character === quote) {
      return source.slice(start, index + 1);
    }

    index += 1;
  }

  return source.slice(start);
}

function highlightScript(source: string): CodeLine[] {
  const lines: CodeLine[] = [[]];
  let index = 0;

  while (index < source.length) {
    const character = source[index];
    const nextCharacter = source[index + 1] ?? "";

    if (character === "/" && nextCharacter === "/") {
      let end = index + 2;

      while (end < source.length && source[end] !== "\n") {
        end += 1;
      }

      pushSegment(lines, source.slice(index, end), "tok-comment");
      index = end;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      let end = index + 2;

      while (end < source.length) {
        if (source[end] === "*" && source[end + 1] === "/") {
          end += 2;
          break;
        }

        end += 1;
      }

      pushSegment(lines, source.slice(index, end), "tok-comment");
      index = end;
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      const stringValue = readQuotedSegment(source, index, character);
      pushSegment(lines, stringValue, "tok-string");
      index += stringValue.length;
      continue;
    }

    if (/\d/.test(character)) {
      let end = index + 1;

      while (end < source.length && /[\d._]/.test(source[end])) {
        end += 1;
      }

      pushSegment(lines, source.slice(index, end), "tok-number");
      index = end;
      continue;
    }

    if (isIdentifierStart(character)) {
      let end = index + 1;

      while (end < source.length && isIdentifierPart(source[end])) {
        end += 1;
      }

      const word = source.slice(index, end);
      const previousCharacter = findPreviousMeaningfulCharacter(source, index);
      const nextMeaningfulCharacter = findNextMeaningfulCharacter(source, end);
      let className = "tok-variableName";

      if (scriptKeywords.has(word)) {
        className = scriptLiterals.has(word) ? "tok-bool" : "tok-keyword";
      } else if (previousCharacter === ".") {
        className = "tok-propertyName";
      } else if (knownTypes.has(word) || /^[A-Z]/.test(word)) {
        className = "tok-typeName";
      } else if (nextMeaningfulCharacter === "(") {
        className = "tok-function";
      }

      pushSegment(lines, word, className);
      index = end;
      continue;
    }

    if (/\s/.test(character)) {
      let end = index + 1;

      while (end < source.length && /\s/.test(source[end])) {
        end += 1;
      }

      pushSegment(lines, source.slice(index, end));
      index = end;
      continue;
    }

    if (/[{}()[\],.;:]/.test(character)) {
      pushSegment(lines, character, "tok-punctuation");
      index += 1;
      continue;
    }

    if (/[=<>!?%+\-*/|&^~]/.test(character)) {
      let end = index + 1;

      while (end < source.length && /[=<>!?%+\-*/|&^~]/.test(source[end])) {
        end += 1;
      }

      pushSegment(lines, source.slice(index, end), "tok-operator");
      index = end;
      continue;
    }

    pushSegment(lines, character);
    index += 1;
  }

  return lines;
}

function highlightShell(source: string): CodeLine[] {
  return source.split("\n").map((line) => {
    const tokens: CodeToken[] = [];
    const parts = line.match(/\s+|&&|\|\||[|;]|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|[^\s|;]+/g) ?? [];
    let hasCommand = false;

    for (const part of parts) {
      let className: string | undefined;

      if (!part.trim()) {
        className = undefined;
      } else if (!hasCommand && shellCommands.has(part)) {
        className = "tok-command";
        hasCommand = true;
      } else if (!hasCommand) {
        className = "tok-command";
        hasCommand = true;
      } else if (shellKeywords.has(part)) {
        className = "tok-keyword";
      } else if (/^-{1,2}[\w-]+$/.test(part)) {
        className = "tok-flag";
      } else if (/^(?:[@A-Za-z0-9][\w./-]*|[A-Za-z0-9][\w-]*)$/.test(part)) {
        className = part.includes("/") || part.includes(".") ? "tok-string" : "tok-package";
      } else if (/^[|;&]+$/.test(part)) {
        className = "tok-operator";
      } else if (part.startsWith('"') || part.startsWith("'") || part.startsWith("`")) {
        className = "tok-string";
      }

      tokens.push({ text: part, className });
    }

    return tokens;
  });
}

function highlightPlain(source: string): CodeLine[] {
  return source.split("\n").map((line) => line ? [{ text: line }] : []);
}

export function formatLanguageLabel(language?: string) {
  const normalized = normalizeLanguage(language);

  switch (normalized) {
    case "bash":
    case "shell":
    case "sh":
      return "Shell";
    case "ts":
    case "typescript":
      return "TypeScript";
    case "js":
    case "javascript":
      return "JavaScript";
    default:
      return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : "Text";
  }
}

export function normalizeLanguage(language?: string) {
  return language?.trim().toLowerCase() ?? "text";
}

export function highlightCode(source: string, language?: string): CodeLine[] {
  const normalized = normalizeLanguage(language);

  if (normalized === "bash" || normalized === "shell" || normalized === "sh") {
    return highlightShell(source);
  }

  if (normalized === "javascript" || normalized === "js" || normalized === "ts" || normalized === "typescript") {
    return highlightScript(source);
  }

  return highlightPlain(source);
}
