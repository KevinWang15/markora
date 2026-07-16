import type { MarkdownEditorChangeMode } from "./editorApi";

export function normalizeMarkdownEditorChangeMode(value: unknown): MarkdownEditorChangeMode {
  if (value === undefined) {
    return "idle";
  }

  if (value === "idle" || value === "immediate" || value === "animationFrame") {
    return value;
  }

  throw new TypeError(
    'onChangeMode must be "idle", "immediate", or "animationFrame".',
  );
}
