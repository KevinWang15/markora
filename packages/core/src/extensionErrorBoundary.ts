import { MarkdownEditorExtensionError } from "./extensionApi";

/** @internal Distinguish fatal construction parsing from later host updates. */
export function runInitialMarkdownParse<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (
      error instanceof MarkdownEditorExtensionError
      && error.phase === "parse"
    ) {
      throw new MarkdownEditorExtensionError({
        code: error.code,
        phase: "initial-parse",
        message: error.message,
        ...(error.extension ? { extension: error.extension } : {}),
        ...(error.participants ? { participants: error.participants } : {}),
        ...(error.contribution ? { contribution: error.contribution } : {}),
        cause: error.cause,
      });
    }

    throw error;
  }
}
